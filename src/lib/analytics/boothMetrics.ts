/**
 * ============================================================================
 * WHAT THE NUMBERS DON'T TELL YOU -- the eight Booth boards.
 * ============================================================================
 *
 * Eight independent, TEAM-based Top 8 rankings derived from the completed games the app already
 * holds. Nothing here is persisted and nothing here feeds the engine: every board is recomputed
 * from authoritative source data on each call, so a board can never disagree with the box score it
 * is drawn from.
 *
 * ---------------------------------------------------------------------------
 * SCOPE, WHICH IS FIXED AND STATED ONCE
 * ---------------------------------------------------------------------------
 *
 * Every board reads the same sample: COMPLETED, REGULAR-SEASON games only (`status === 'completed'`
 * and `phase === 'regular_season'`). The app holds a single season's schedule at a time, so "the
 * season" is whatever `games` is passed in. Games are de-duplicated by `gameId` before counting, so
 * a record reachable through two collections cannot be counted twice.
 *
 * Postseason games are excluded by decision, not by omission: the boards are a regular-season
 * reading, and mixing October into a win board changes the question.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS STORED, AND WHY IT IS READ THIS WAY
 * ---------------------------------------------------------------------------
 *
 * `Game.stats` is a loose `Record`, and the two things several boards need are JSON STRINGS inside
 * it:
 *
 *   stats.lineScore  -> InningLine[]  (runs per inning, per side)
 *   stats.playLog    -> PlayLogEvent[] (one row per plate appearance)
 *
 * Both are written by `gameEngine.buildCompletedGameFromSession` and both survive storage
 * (`localGamesMirror` protects `lineScore` outright). The parsers below return `null` for a MISSING
 * or UNPARSEABLE value, and that is deliberately different from the existing `parseStoredPlayLog`,
 * which returns `[]` for both. A board that needs a play log has to tell "no log at all" apart from
 * "a log in which nothing happened", because returning zero for the former is exactly the
 * silent-zero failure the boards must avoid.
 *
 * TEMPERATURE is the one derived input. There is no persisted per-game weather (by decision), so
 * Heat Seeking Missiles and Cold Blooded Killers read `gameTemperatureF`, the same deterministic,
 * per-game, park-plus-month value the game screen's thermometer shows. It is seeded by `gameId`, so
 * a board reproduces itself on every render and after a save round-trip.
 *
 * The one thing that would move a historical result is an edit to the park CLIMATE data itself, which
 * is the accepted cost of not persisting a snapshot. It is the reason the value is derived from the
 * park's own monthly curve and never read from a stored copy that could drift out of step with its
 * source; if park data is ever edited mid-season, the affected games' temperatures -- and these two
 * boards -- move with it, by design.
 *
 * ---------------------------------------------------------------------------
 * INCLUSION AND TIE-BREAKING
 * ---------------------------------------------------------------------------
 *
 * A COUNT board (late runs, comeback wins, shutouts) ranks teams by a count and takes eight.
 * Nothing is padded: if fewer teams have the relevant data, the board is shorter, never filled with
 * rows that mean nothing.
 *
 * A PERCENTAGE board (Giant Slayers, Fence Leapers, the two weather boards) ranks by a rate, highest
 * first, and prints that rate as a percentage -- `64.5%`, never `.645`. The sample behind the rate is
 * one of the supporting figures, because a rate without its denominator is a rate you cannot check.
 * A team with no qualifying game is ABSENT rather than ranked at 0%; where a board is about having
 * DONE the thing (winning a warm game, hitting a home run), only teams that have done it are listed.
 *
 * A RECORD board (One-Run Specialists) ranks by WINS and prints the record, not a percentage: a team
 * that has won nine one-run games outranks one that has won eight, and a single lucky win cannot top
 * the board the way an empty sample's 1.000 would.
 *
 * Every board sorts on its primary metric descending and then on a stated, deterministic set of
 * secondary keys ending in `teamId`, so the order is identical on every render. Ranks are therefore
 * unique; two teams with the same primary are separated by the advertised secondary, never at random.
 */

import type { Game, InningLine, PlayLogEvent, Team } from '../../types';
import { fmtDiff, fmtPct, fmtRecord } from '../../logic/statFormatting';
import { gameTemperatureF } from '../gameTemperature';

/* ------------------------------------------------------------------------- *
 * CONSTANTS -- the two weather cutoffs are the spec's, and they are exclusive.
 * ------------------------------------------------------------------------- */

/** A game at or above this many degrees Fahrenheit is a WARM game. */
export const WARM_THRESHOLD_F = 62;
/** A game at or below this many degrees Fahrenheit is a COLD game. The two cutoffs share no degree. */
export const COLD_THRESHOLD_F = 61;
/** "Second half" of a game means the fifth inning and everything after it. */
export const LATE_INNING_START = 5;
/** The comeback checkpoint: the score after the fourth inning has FULLY concluded. */
export const COMEBACK_CHECKPOINT_INNING = 4;
/** A board never prints more than eight teams. */
export const BOARD_SIZE = 8;

/* ------------------------------------------------------------------------- *
 * TYPES
 * ------------------------------------------------------------------------- */

export const BOOTH_BOARD_IDS = [
  'second_half_kings',
  'giant_slayers',
  'one_run_specialists',
  'comeback_kids',
  'shutout_wins',
  'fence_leapers',
  'heat_seeking_missiles',
  'cold_blooded_killers',
] as const;

export type BoothBoardId = (typeof BOOTH_BOARD_IDS)[number];

/** One supporting figure printed under a row. Already formatted. */
export interface BoothSupportStat {
  label: string;
  value: string;
}

/** One ranked team on a board. */
export interface BoothBoardRow {
  teamId: string;
  teamCity: string;
  teamName: string;
  /** The primary metric as a number, after sorting. Its units are the board's own. */
  primaryValue: number;
  /** The primary metric as it prints, e.g. `.632`, `238`, `18.4%`. */
  primaryDisplay: string;
  /** Supporting statistics, in display order. */
  support: BoothSupportStat[];
}

export interface BoothBoard {
  id: BoothBoardId;
  title: string;
  /** The one-line question the board answers, printed under the title. */
  question: string;
  /** What the primary column is called. */
  primaryLabel: string;
  rows: BoothBoardRow[];
  /** Why the board is empty, when it is. Absent when the board has rows. */
  emptyReason?: string;
  /** A board-level caption about data coverage or the qualifying range, when there is one. */
  note?: string;
}

/* ------------------------------------------------------------------------- *
 * PARSERS -- null means "not readable", which is not the same as "empty".
 * ------------------------------------------------------------------------- */

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const parseLineScore = (game: Game): InningLine[] | null => {
  const raw = game.stats?.lineScore;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const lines: InningLine[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      if (!isFiniteNumber(row.inning) || !isFiniteNumber(row.away) || !isFiniteNumber(row.home)) {
        return null;
      }
      lines.push({ inning: row.inning, away: row.away, home: row.home });
    }
    return lines;
  } catch {
    return null;
  }
};

const parsePlayLog = (game: Game): PlayLogEvent[] | null => {
  const raw = game.stats?.playLog;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlayLogEvent[]) : null;
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------------- *
 * SCOPE
 * ------------------------------------------------------------------------- */

/**
 * The season a date belongs to, taken as its calendar year.
 *
 * A season runs spring to autumn of a single year, so the year of a game's date IS its season. This
 * is the same rule `resolveSeasonYear` uses; it is stated here rather than imported because that
 * function answers a different question (which season a screen should show) from a different input
 * (the current date), and a board must key off each game's own date.
 */
const seasonYearOf = (date: string): number => Number(date.slice(0, 4));

/**
 * The sample every board reads: completed, regular-season, de-duplicated games -- optionally pinned
 * to one season.
 *
 * The de-duplication is by `gameId` and is cheap insurance against a caller handing over a list
 * assembled from more than one collection -- a game counted twice would double every count on every
 * count board, and double-counting is the one error a ranking cannot recover from silently.
 *
 * `seasonYear` is optional because the app holds one season at a time and usually does not need to
 * say which. Passing it makes the scope explicit and is what keeps two seasons from ever being
 * averaged together if a caller ever hands over more than one.
 */
export const boothScopeGames = (games: readonly Game[], seasonYear?: number): Game[] => {
  const seen = new Set<string>();
  const scoped: Game[] = [];
  for (const game of games) {
    if (game.status !== 'completed') continue;
    if (game.phase !== 'regular_season') continue;
    if (seasonYear !== undefined && seasonYearOf(game.date) !== seasonYear) continue;
    if (seen.has(game.gameId)) continue;
    seen.add(game.gameId);
    scoped.push(game);
  }
  return scoped;
};

const decisiveWinner = (game: Game): string | null => {
  if (game.score.home === game.score.away) return null;
  return game.score.home > game.score.away ? game.homeTeam : game.awayTeam;
};

const decisiveLoser = (game: Game): string | null => {
  if (game.score.home === game.score.away) return null;
  return game.score.home > game.score.away ? game.awayTeam : game.homeTeam;
};

/* ------------------------------------------------------------------------- *
 * SHARED ROW BUILDERS
 * ------------------------------------------------------------------------- */

interface TeamIdentity {
  teamId: string;
  teamCity: string;
  teamName: string;
}

const identityOf = (teamById: Map<string, Team>, teamId: string): TeamIdentity => {
  const team = teamById.get(teamId);
  return { teamId, teamCity: team?.city ?? teamId, teamName: team?.name ?? '' };
};

const byTeamId = (a: { teamId: string }, b: { teamId: string }): number =>
  a.teamId.localeCompare(b.teamId);

/** A tally cell that creates itself on first touch. */
const bump = (map: Map<string, number>, key: string, by = 1): void => {
  map.set(key, (map.get(key) ?? 0) + by);
};

/* ------------------------------------------------------------------------- *
 * BOARD 1 -- 2ND HALF KINGS
 *
 * Total runs each team scores in the fifth inning and later, extras included. A team that scores 20
 * after the fourth outranks one that scores 19, whatever the season totals say.
 * ------------------------------------------------------------------------- */

const secondHalfKings = (scope: readonly Game[], teamById: Map<string, Team>): BoothBoard => {
  const scored = new Map<string, number>();
  const allowed = new Map<string, number>();
  let unreadableLineScores = 0;

  for (const game of scope) {
    // Both sides appear even if the game never reached the fifth, so a team is never absent merely
    // because its late innings were all zeros.
    bump(scored, game.homeTeam, 0);
    bump(scored, game.awayTeam, 0);
    bump(allowed, game.homeTeam, 0);
    bump(allowed, game.awayTeam, 0);

    const line = parseLineScore(game);
    if (!line) {
      unreadableLineScores += 1;
      continue;
    }
    for (const inning of line) {
      if (inning.inning < LATE_INNING_START) continue;
      bump(scored, game.homeTeam, inning.home);
      bump(allowed, game.homeTeam, inning.away);
      bump(scored, game.awayTeam, inning.away);
      bump(allowed, game.awayTeam, inning.home);
    }
  }

  const ranked = [...scored.keys()].map((teamId) => {
    const runs = scored.get(teamId) ?? 0;
    const runsAllowed = allowed.get(teamId) ?? 0;
    return { teamId, runs, runsAllowed, diff: runs - runsAllowed };
  });

  ranked.sort((a, b) =>
    b.runs - a.runs || b.diff - a.diff || byTeamId(a, b));

  const rows: BoothBoardRow[] = ranked.slice(0, BOARD_SIZE).map((entry) => ({
    ...identityOf(teamById, entry.teamId),
    primaryValue: entry.runs,
    primaryDisplay: String(entry.runs),
    support: [
      { label: 'Allowed', value: String(entry.runsAllowed) },
      { label: 'Diff', value: fmtDiff(entry.diff) },
    ],
  }));

  return {
    id: 'second_half_kings',
    title: '2nd Half Kings',
    question: 'Which teams score the most runs in the fifth inning and later?',
    primaryLabel: 'Late runs',
    rows,
    emptyReason: rows.length === 0 ? 'No completed regular-season games yet.' : undefined,
    note: unreadableLineScores > 0
      ? `${unreadableLineScores} completed ${unreadableLineScores === 1 ? 'game has' : 'games have'} no readable line score and ${unreadableLineScores === 1 ? 'contributes' : 'contribute'} nothing.`
      : undefined,
  };
};

/* ------------------------------------------------------------------------- *
 * BOARD 2 -- GIANT SLAYERS
 *
 * The WIN RATE against opponents that finish strictly above .500 -- the spec's own primary metric --
 * ranked highest first and printed as a percentage, with the record it came from as a supporting
 * figure. It was briefly ranked by the raw count of giant wins; the spec asks for the rate, and the
 * rate is what the name promises: how a team does when it meets a giant, not how many giants happen
 * to be on its schedule. The opponent's record is computed EXCLUDING the games it played against the
 * team being judged, so no team helps decide whether its own opponent qualifies.
 * ------------------------------------------------------------------------- */

const giantSlayers = (scope: readonly Game[], teamById: Map<string, Team>): BoothBoard => {
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  /**
   * `versus[team][opponent]` = that team's wins and losses against that opponent.
   *
   * BOTH DIRECTIONS are recorded. An earlier cut stored only winner -> loser, which meant a club
   * that never won a game had no entry at all and could not be evaluated -- so a team that went
   * 0-2 against a giant vanished instead of appearing at .000. The opponent relation has to be
   * symmetric regardless of who won.
   */
  const versus = new Map<string, Map<string, { wins: number; losses: number }>>();

  const record = (map: Map<string, number>, teamId: string): number => map.get(teamId) ?? 0;

  const link = (teamId: string, opponentId: string, won: boolean): void => {
    const row = versus.get(teamId) ?? new Map<string, { wins: number; losses: number }>();
    const cell = row.get(opponentId) ?? { wins: 0, losses: 0 };
    if (won) cell.wins += 1;
    else cell.losses += 1;
    row.set(opponentId, cell);
    versus.set(teamId, row);
  };

  for (const game of scope) {
    const winner = decisiveWinner(game);
    const loser = decisiveLoser(game);
    if (!winner || !loser) continue;
    bump(wins, winner);
    bump(losses, loser);
    link(winner, loser, true);
    link(loser, winner, false);
  }

  const ranked: Array<{
    teamId: string;
    pct: number;
    giantWins: number;
    giantLosses: number;
    giantGames: number;
    opponents: number;
  }> = [];

  for (const [teamId, faced] of versus) {
    let giantWins = 0;
    let giantLosses = 0;
    let opponents = 0;

    for (const [opponentId, cell] of faced) {
      const meetings = cell.wins + cell.losses;
      if (meetings === 0) continue;

      // The opponent's record with its games against THIS team removed. `cell.losses` is how often
      // this team won, i.e. how many of the opponent's wins to remove; `cell.wins` is how many of
      // the opponent's losses to remove.
      const opponentWinsExcl = record(wins, opponentId) - cell.losses;
      const opponentLossesExcl = record(losses, opponentId) - cell.wins;
      const opponentGamesExcl = opponentWinsExcl + opponentLossesExcl;
      if (opponentGamesExcl <= 0) continue;

      const opponentPctExcl = opponentWinsExcl / opponentGamesExcl;
      // STRICTLY greater than .500. An opponent at exactly .500 does not qualify.
      if (opponentPctExcl > 0.5) {
        opponents += 1;
        giantWins += cell.wins;
        giantLosses += cell.losses;
      }
    }

    const giantGames = giantWins + giantLosses;
    if (giantGames === 0) continue; // No qualifying opponents: absent, not .000.
    ranked.push({
      teamId,
      pct: giantWins / giantGames,
      giantWins,
      giantLosses,
      giantGames,
      opponents,
    });
  }

  // The rate is the ranking. More giant wins breaks a tie on the rate -- a 2-0 and a 1-0 are both
  // 1.000, and the larger sample is the more earned of the two -- then team id, so the order is
  // identical on every render.
  ranked.sort((a, b) =>
    b.pct - a.pct || b.giantWins - a.giantWins || byTeamId(a, b));

  const rows: BoothBoardRow[] = ranked.slice(0, BOARD_SIZE).map((entry) => ({
    ...identityOf(teamById, entry.teamId),
    primaryValue: entry.pct * 100,
    primaryDisplay: `${(entry.pct * 100).toFixed(1)}%`,
    support: [
      { label: 'vs >.500', value: fmtRecord(entry.giantWins, entry.giantLosses) },
      {
        label: 'above .500 faced',
        value: `${entry.opponents} ${entry.opponents === 1 ? 'team' : 'teams'}`,
      },
    ],
  }));

  return {
    id: 'giant_slayers',
    title: 'Giant Slayers',
    question: 'Which teams have the best record against above-.500 opponents?',
    primaryLabel: 'Win% vs >.500',
    rows,
    emptyReason: rows.length === 0
      ? 'No team has faced an opponent that finishes above .500 yet.'
      : undefined,
  };
};

/* ------------------------------------------------------------------------- *
 * BOARD 3 -- ONE-RUN SPECIALISTS
 *
 * WINS in games decided by exactly one run, extras included, ranked by how many were won. This is the
 * one board that still ranks on a raw COUNT and prints the RECORD rather than a percentage: a single
 * one-run win cannot top the board the way a 1.000 would.
 * ------------------------------------------------------------------------- */

const oneRunSpecialists = (scope: readonly Game[], teamById: Map<string, Team>): BoothBoard => {
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();

  for (const game of scope) {
    if (Math.abs(game.score.home - game.score.away) !== 1) continue;
    const winner = decisiveWinner(game);
    const loser = decisiveLoser(game);
    if (!winner || !loser) continue;
    bump(wins, winner);
    bump(losses, loser);
  }

  const ranked = [...new Set([...wins.keys(), ...losses.keys()])].map((teamId) => {
    const w = wins.get(teamId) ?? 0;
    const l = losses.get(teamId) ?? 0;
    const games = w + l;
    return { teamId, w, l, games, pct: games > 0 ? w / games : 0 };
  }).filter((entry) => entry.games > 0);

  ranked.sort((a, b) =>
    b.w - a.w || b.pct - a.pct || b.games - a.games || byTeamId(a, b));

  const rows: BoothBoardRow[] = ranked.slice(0, BOARD_SIZE).map((entry) => ({
    ...identityOf(teamById, entry.teamId),
    primaryValue: entry.w,
    primaryDisplay: fmtRecord(entry.w, entry.l),
    support: [
      { label: 'one-run games', value: String(entry.games) },
    ],
  }));

  return {
    id: 'one_run_specialists',
    title: 'One-Run Specialists',
    question: 'Which teams have won the most one-run games?',
    primaryLabel: 'One-run record',
    rows,
    emptyReason: rows.length === 0 ? 'No one-run games have been completed yet.' : undefined,
  };
};

/* ------------------------------------------------------------------------- *
 * BOARD 4 -- COMEBACK KIDS
 *
 * Wins after trailing at the END OF THE FOURTH. The checkpoint is the score once the fourth has
 * fully concluded, which is not simply "the last event in inning four".
 * ------------------------------------------------------------------------- */

/**
 * Whether the fourth inning has conclusively finished.
 *
 * A game with any fifth inning certainly has. A game whose highest recorded inning is four has not,
 * unless the play log proves the bottom of the fourth ended -- a `HALF_END` at inning 4, half
 * `bottom` -- or the stored `finalInning` is greater than four. Anything else is excluded rather
 * than guessed at, because counting a game that stopped in the middle of the fourth would attribute
 * a comeback to a trailing-after-four score that was never reached.
 */
const fourthInningConcluded = (game: Game, line: InningLine[]): boolean => {
  const maxInning = line.reduce((max, inning) => Math.max(max, inning.inning), 0);
  if (maxInning >= LATE_INNING_START) return true;

  const finalInning = game.stats?.finalInning;
  if (typeof finalInning === 'number' && finalInning > COMEBACK_CHECKPOINT_INNING) return true;

  const log = parsePlayLog(game);
  if (log) {
    return log.some((event) =>
      event.inning === COMEBACK_CHECKPOINT_INNING
      && event.half === 'bottom'
      && event.outcome === 'HALF_END');
  }
  return false;
};

const comebackKids = (scope: readonly Game[], teamById: Map<string, Team>): BoothBoard => {
  const comebackWins = new Map<string, number>();
  const gamesTrailing = new Map<string, number>();
  let excludedCheckpoint = 0;
  let unreadableLineScores = 0;

  for (const game of scope) {
    const line = parseLineScore(game);
    if (!line) {
      unreadableLineScores += 1;
      continue;
    }
    if (!fourthInningConcluded(game, line)) {
      excludedCheckpoint += 1;
      continue;
    }

    let awayAfterFour = 0;
    let homeAfterFour = 0;
    for (const inning of line) {
      if (inning.inning > COMEBACK_CHECKPOINT_INNING) continue;
      awayAfterFour += inning.away;
      homeAfterFour += inning.home;
    }

    // A tie after four means nobody was trailing, so there is no comeback to count either way.
    if (awayAfterFour === homeAfterFour) continue;

    const trailingTeam = awayAfterFour < homeAfterFour ? game.awayTeam : game.homeTeam;
    bump(gamesTrailing, trailingTeam);
    if (decisiveWinner(game) === trailingTeam) {
      bump(comebackWins, trailingTeam);
    }
  }

  const ranked = [...gamesTrailing.keys()].map((teamId) => {
    const wins = comebackWins.get(teamId) ?? 0;
    const trailing = gamesTrailing.get(teamId) ?? 0;
    return { teamId, wins, trailing, conversion: trailing > 0 ? wins / trailing : 0 };
  });

  ranked.sort((a, b) =>
    b.wins - a.wins || b.conversion - a.conversion || byTeamId(a, b));

  const rows: BoothBoardRow[] = ranked.slice(0, BOARD_SIZE).map((entry) => ({
    ...identityOf(teamById, entry.teamId),
    primaryValue: entry.wins,
    primaryDisplay: String(entry.wins),
    support: [
      { label: 'Trailed after 4', value: String(entry.trailing) },
      { label: 'Converted', value: fmtPct(entry.conversion) },
    ],
  }));

  const noteParts: string[] = [];
  if (unreadableLineScores > 0) {
    noteParts.push(`${unreadableLineScores} ${unreadableLineScores === 1 ? 'game has' : 'games have'} no readable line score.`);
  }
  if (excludedCheckpoint > 0) {
    noteParts.push(`${excludedCheckpoint} ${excludedCheckpoint === 1 ? 'game ended' : 'games ended'} before the fourth inning finished.`);
  }

  return {
    id: 'comeback_kids',
    title: 'Comeback Kids',
    question: 'Which teams win most often after trailing through four innings?',
    primaryLabel: 'Comeback wins',
    rows,
    emptyReason: rows.length === 0 ? 'No completed game has had a fourth inning yet.' : undefined,
    note: noteParts.length > 0 ? noteParts.join(' ') : undefined,
  };
};

/* ------------------------------------------------------------------------- *
 * BOARD 5 -- SHUTOUT WINS
 *
 * Wins in which the opponent scored exactly zero. A 1-0 win counts; extras count.
 * ------------------------------------------------------------------------- */

const shutoutWins = (scope: readonly Game[], teamById: Map<string, Team>): BoothBoard => {
  const shutouts = new Map<string, number>();
  const totalWins = new Map<string, number>();

  for (const game of scope) {
    const winner = decisiveWinner(game);
    if (!winner) continue; // A 0-0 (or tied) result is not a win for anyone.
    bump(totalWins, winner);
    if (Math.min(game.score.home, game.score.away) === 0) {
      bump(shutouts, winner);
    }
  }

  const ranked = [...shutouts.keys()].map((teamId) => {
    const count = shutouts.get(teamId) ?? 0;
    const wins = totalWins.get(teamId) ?? 0;
    return { teamId, count, wins, share: wins > 0 ? count / wins : 0 };
  }).filter((entry) => entry.count > 0);

  ranked.sort((a, b) =>
    b.count - a.count || b.wins - a.wins || byTeamId(a, b));

  const rows: BoothBoardRow[] = ranked.slice(0, BOARD_SIZE).map((entry) => ({
    ...identityOf(teamById, entry.teamId),
    primaryValue: entry.count,
    primaryDisplay: String(entry.count),
    support: [
      { label: 'Total wins', value: String(entry.wins) },
      { label: 'Of wins', value: fmtPct(entry.share) },
    ],
  }));

  return {
    id: 'shutout_wins',
    title: 'Shutout Wins',
    question: 'Which teams have won the most games without allowing a run?',
    primaryLabel: 'Shutouts',
    rows,
    emptyReason: rows.length === 0 ? 'No shutouts have been recorded yet.' : undefined,
  };
};

/* ------------------------------------------------------------------------- *
 * BOARD 6 -- FENCE LEAPERS
 *
 * The share of a team's runs that came on home-run plays. The numerator is the `runsScored` of each
 * `HR` event -- so a three-run homer contributes three -- and the denominator is the same team's
 * total runs, over the SAME games, so the ratio is internally consistent.
 * ------------------------------------------------------------------------- */

const fenceLeapers = (scope: readonly Game[], teamById: Map<string, Team>): BoothBoard => {
  const hrRuns = new Map<string, number>();
  const totalRuns = new Map<string, number>();
  const hrCount = new Map<string, number>();
  let unreadableLogs = 0;
  let loggedGames = 0;

  for (const game of scope) {
    const log = parsePlayLog(game);
    if (!log) {
      unreadableLogs += 1;
      continue;
    }
    loggedGames += 1;
    // Total runs come from the same logged games as the HR runs, so a game with no log cannot make a
    // team's denominator larger than the numerator's sample.
    bump(totalRuns, game.homeTeam, game.score.home);
    bump(totalRuns, game.awayTeam, game.score.away);

    for (const event of log) {
      if (event.outcome !== 'HR') continue;
      const teamId = event.battingTeamId;
      if (!teamId) continue;
      const runs = isFiniteNumber(event.runsScored) ? event.runsScored : 0;
      bump(hrRuns, teamId, runs);
      bump(hrCount, teamId);
    }
  }

  const ranked = [...totalRuns.keys()].map((teamId) => {
    const total = totalRuns.get(teamId) ?? 0;
    const homerRuns = hrRuns.get(teamId) ?? 0;
    return {
      teamId,
      total,
      homerRuns,
      homeRuns: hrCount.get(teamId) ?? 0,
      pct: total > 0 ? (homerRuns / total) * 100 : 0,
    };
  }).filter((entry) => entry.total > 0);

  // A team cannot score more runs on homers than it scored at all. If this ever fires, the
  // attribution is wrong and the board should not be trusted; the checker asserts it never does.
  const overcounted = ranked.filter((entry) => entry.homerRuns > entry.total);

  ranked.sort((a, b) =>
    b.pct - a.pct || b.homerRuns - a.homerRuns || byTeamId(a, b));

  const rows: BoothBoardRow[] = ranked.slice(0, BOARD_SIZE).map((entry) => ({
    ...identityOf(teamById, entry.teamId),
    primaryValue: entry.pct,
    primaryDisplay: `${entry.pct.toFixed(1)}%`,
    support: [
      { label: 'HR runs', value: String(entry.homerRuns) },
      { label: 'Total runs', value: String(entry.total) },
      { label: 'HRs', value: String(entry.homeRuns) },
    ],
  }));

  const noteParts: string[] = [];
  if (unreadableLogs > 0) {
    noteParts.push(`${unreadableLogs} ${unreadableLogs === 1 ? 'game has' : 'games have'} no play log and ${unreadableLogs === 1 ? 'is' : 'are'} excluded.`);
  }
  if (overcounted.length > 0) {
    noteParts.push(`Data warning: ${overcounted.length} ${overcounted.length === 1 ? 'team has' : 'teams have'} more homer runs than total runs.`);
  }

  return {
    id: 'fence_leapers',
    title: 'Fence Leapers',
    question: "Which teams rely most on the home run to produce their runs?",
    primaryLabel: 'Runs on HR',
    rows,
    emptyReason: rows.length === 0
      ? (loggedGames === 0 ? 'No completed game carries a play log yet.' : 'No runs have been recorded yet.')
      : undefined,
    note: noteParts.length > 0 ? noteParts.join(' ') : undefined,
  };
};

/* ------------------------------------------------------------------------- *
 * BOARDS 7 & 8 -- HEAT SEEKING MISSILES / COLD BLOODED KILLERS
 *
 * The WIN RATE in games whose per-game temperature clears the warm or cold threshold, ranked highest
 * first and printed as a percentage. It was originally a raw win count; a rate is the fairer read,
 * because a club that plays most of its games in the cold should not top a wins board over one that
 * plays in the heat, on volume alone. Only teams that actually won a qualifying game are listed -- a
 * board about winning in the heat whose rows never won in the heat is not a story. Temperature is the
 * deterministic, per-game value (`gameTemperatureF`), never a park's monthly mean. Says so on the
 * board, because the value is derived rather than recorded.
 * ------------------------------------------------------------------------- */

const weatherBoard = (
  kind: 'warm' | 'cold',
  scope: readonly Game[],
  teamById: Map<string, Team>,
): BoothBoard => {
  const wins = new Map<string, number>();
  const games = new Map<string, number>();
  let parkless = 0;
  let minTemp: number | null = null;
  let maxTemp: number | null = null;

  for (const game of scope) {
    const temperatureF = gameTemperatureF(game.homeTeam, game.date, game.gameId);
    if (temperatureF === null) {
      parkless += 1;
      continue;
    }
    const qualifies = kind === 'warm'
      ? temperatureF >= WARM_THRESHOLD_F
      : temperatureF <= COLD_THRESHOLD_F;
    if (!qualifies) continue;

    minTemp = minTemp === null ? temperatureF : Math.min(minTemp, temperatureF);
    maxTemp = maxTemp === null ? temperatureF : Math.max(maxTemp, temperatureF);

    bump(games, game.homeTeam);
    bump(games, game.awayTeam);
    const winner = decisiveWinner(game);
    if (winner) bump(wins, winner);
  }

  const ranked = [...games.keys()].map((teamId) => {
    const teamWins = wins.get(teamId) ?? 0;
    const teamGames = games.get(teamId) ?? 0;
    return {
      teamId,
      wins: teamWins,
      games: teamGames,
      pct: teamGames > 0 ? teamWins / teamGames : 0,
    };
  }).filter((entry) => entry.wins > 0);

  ranked.sort((a, b) =>
    b.pct - a.pct || b.wins - a.wins || byTeamId(a, b));

  const rows: BoothBoardRow[] = ranked.slice(0, BOARD_SIZE).map((entry) => ({
    ...identityOf(teamById, entry.teamId),
    primaryValue: entry.pct * 100,
    primaryDisplay: `${(entry.pct * 100).toFixed(1)}%`,
    support: [
      { label: 'Wins', value: String(entry.wins) },
      { label: 'Games', value: String(entry.games) },
    ],
  }));

  const label = kind === 'warm' ? 'warm' : 'cold';
  const threshold = kind === 'warm' ? WARM_THRESHOLD_F : COLD_THRESHOLD_F;
  const range = minTemp !== null && maxTemp !== null
    ? `${minTemp}\u00B0F\u2013${maxTemp}\u00B0F`
    : null;
  const noteParts: string[] = [
    `${label[0].toUpperCase()}${label.slice(1)} games are ${kind === 'warm' ? 'at or above' : 'at or below'} ${threshold}\u00B0F.`,
  ];
  if (range) noteParts.push(`Qualifying range ${range}.`);
  if (parkless > 0) noteParts.push(`${parkless} ${parkless === 1 ? 'game has' : 'games have'} no park temperature.`);

  return {
    id: kind === 'warm' ? 'heat_seeking_missiles' : 'cold_blooded_killers',
    title: kind === 'warm' ? 'Heat Seeking Missiles' : 'Cold Blooded Killers',
    question: kind === 'warm'
      ? 'Which teams win the highest share of their games in the heat?'
      : 'Which teams win the highest share of their games in the cold?',
    primaryLabel: kind === 'warm' ? 'Warm win%' : 'Cold win%',
    rows,
    emptyReason: rows.length === 0
      ? `No ${label} game has produced a winner yet.`
      : undefined,
    note: noteParts.join(' '),
  };
};

/* ------------------------------------------------------------------------- *
 * PUBLIC ENTRY POINT
 * ------------------------------------------------------------------------- */

/**
 * Every Booth board, in the order they appear on the page.
 *
 * @param teams      every club, for name and city lookup. A team id with no team still ranks; it
 *                   prints its id rather than being dropped, so a missing club is visible rather
 *                   than silent.
 * @param games      every game the app holds; only completed regular-season games are read.
 * @param seasonYear optional season pin. When given, games from any other season are ignored, so
 *                   two seasons can never be averaged together.
 */
export const deriveBoothBoards = (
  teams: readonly Team[],
  games: readonly Game[],
  seasonYear?: number,
): BoothBoard[] => {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const scope = boothScopeGames(games, seasonYear);

  return [
    secondHalfKings(scope, teamById),
    giantSlayers(scope, teamById),
    oneRunSpecialists(scope, teamById),
    comebackKids(scope, teamById),
    shutoutWins(scope, teamById),
    fenceLeapers(scope, teamById),
    weatherBoard('warm', scope, teamById),
    weatherBoard('cold', scope, teamById),
  ];
};
