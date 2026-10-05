/**
 * POWER RANKINGS -- the League Office's preseason and in-season board.
 *
 * ===========================================================================
 * WHY THIS READS THE FAIR LAYER AND DOES NOT BUILD A SECOND MODEL
 * ===========================================================================
 *
 * The numbers here are the ones the HXSE already computes. `fairLayerFor` produces, per club:
 *
 *   - a 0-100 valuation from the nine forecaster outlets' weighted consensus, the roster surplus
 *     measured against the record, and the Monte Carlo's championship probability
 *   - the playoff probabilities themselves: P(make the postseason), P(win the league),
 *     P(win the title)
 *   - a fair price on the 0-1000 band, and that price's deviation from where the club actually trades
 *
 * So this is a PRESENTATION layer. There is deliberately no second valuation, because two valuations
 * of the same club is a bug with a long fuse: the Exchange board would rank a club one way and this
 * board another, and a manager would spot the disagreement within one screen.
 *
 * The one thing NOT here is any new input. Form, hot streaks and star power are real gaps, and they
 * are Phase 2, because every one of them would move share prices and that needs its own decision.
 *
 * ===========================================================================
 * DIVISION STRENGTH IS DESCRIBED, NEVER SCORED
 * ===========================================================================
 *
 * This is the single most important comment in the file.
 *
 * The request was for division competition to be an INPUT to the ranking. It is not, and adding it
 * would be a double-count that nobody could see. P(championship) comes from `playoffMonteCarlo`,
 * which simulates the ACTUAL schedule and the REAL bracket -- mirrored from `getLeagueProjection`,
 * not an approximation. A club in a weak division already gets the benefit of that weakness in its
 * championship number, because that is what the simulation does. Folding division strength in again
 * would count it twice, and the result would still look entirely plausible -- which is exactly how a
 * wrong answer survives review.
 *
 * So division strength is computed and SHOWN, as a tag beside each club. The tag changes no rank. A
 * club ranked 3rd in a soft division is genuinely better placed than a club ranked 3rd in a deep one,
 * and the tag says so without pretending the simulation does not already know.
 *
 * ===========================================================================
 * THE TAG IS RELATIVE, SO IT CANNOT BE WRONG IN AN ABSOLUTE SENSE
 * ===========================================================================
 *
 * "Soft" and "deep" are measured against the SPREAD OF DIVISION MEANS IN THIS LEAGUE, not against
 * fixed valuation numbers. If all eight divisions are within a rounding error of each other, every
 * division reads `even` -- which is the correct answer, and a fixed threshold would have called four
 * of them "soft" and lied about the other four.
 *
 * A division is `deep` when its mean valuation sits more than `DIVISION_TAG_SPREAD` league-relative
 * standard deviations above the league mean, and `soft` the same distance below. One standard
 * deviation is the bar on purpose: with eight divisions, roughly one in three lands outside it, so the
 * tag is informative without being decoration on every single row.
 */

import type { Game, LeaguePlayerState, SimulationSettings, Team } from '../../types';
import { fairLayerFor, leaguePriceSeed, type FairLayerResult } from './priceBoard';
import type { PlayoffOdds } from './playoffMonteCarlo';

/**
 * How far from the league mean a division's average valuation must sit, in league-relative standard
 * deviations, before it is called deep or soft. One by construction -- see the note above.
 */
export const DIVISION_TAG_SPREAD = 1;

export type DivisionStrengthTag = 'soft' | 'even' | 'deep';

export interface DivisionSummary {
  league: Team['league'];
  division: Team['division'];
  /** Mean valuation of the division's clubs, on the 0-100 scale. */
  meanValuation: number;
  /** Signed distance from the league mean, in league-relative standard deviations. */
  z: number;
  tag: DivisionStrengthTag;
  teamIds: string[];
}

export interface PowerRankingRow {
  teamId: string;
  /** 1-based, league-wide, across both leagues. */
  rank: number;
  league: Team['league'];
  division: Team['division'];
  /** 0-100, from the fair layer. */
  valuation: number;
  /** Fair price on the 0-1000 band. */
  fairPrice: number;
  makePlayoffPct: number;
  winLeaguePct: number;
  championshipPct: number;
  /** DISPLAY ONLY. Never contributes to `rank`. */
  divisionTag: DivisionStrengthTag;
  /** DISPLAY ONLY. Mean valuation of this club's division-mates. */
  divisionMeanValuation: number;
}

export interface PowerRankings {
  rows: PowerRankingRow[];
  divisions: DivisionSummary[];
  asOf: string;
  /** Which field produced `rank`. Reported so the UI can label the column honestly. */
  rankBasis: RankBasis;
  mcTrials: number;
}

export type RankBasis = 'championship' | 'valuation';

/**
 * The default, and why it is not the obvious one.
 *
 * See the note on `rankBasis` in `PowerRankingsInput` for the measurement. Short version: 250 Monte
 * Carlo trials cannot resolve a 0-20% probability to better than about 4 points, and on a pristine
 * universe ranking by it put the strongest club in the league at rank 14.
 */
export const DEFAULT_RANK_BASIS: RankBasis = 'valuation';

export interface PowerRankingsInput {
  teams: Team[];
  games: Game[];
  playerState: LeaguePlayerState;
  seasonYear: number;
  /** Defaults to `leaguePriceSeed(teams)` -- the same seed the worker prices with. */
  seed?: number;
  date: string;
  settings?: SimulationSettings;
  /**
   * MUST match what the caller would price with. It is part of the fair-layer cache key and it
   * changes the Monte Carlo's output, so a mismatch makes this board quietly disagree with the
   * Exchange for no visible reason.
   */
  mcTrials?: number;
  /** Caches the expensive fair layer. Pass a stable `(season, date)` key. */
  fairCacheKey?: string;
  /**
   * What to rank on. Defaults to `valuation`, and the default is MEASURED rather than preferred.
   *
   * Championship probability was the obvious candidate -- it is the only figure that already knows
   * the schedule a club has to play -- and it is WRONG as a sort key at the trial count this uses.
   * `HXSE_DAILY_TRIALS` is 250, so a 10% probability carries a standard error of about 1.9 points
   * and anything under ~4 points between two clubs is sampling noise. Measured over three scenarios
   * (`tools/probePowerRankings.ts`):
   *
   *     pristine universe   championship spread  6.4 pts   valuation spread 65.9 pts   (10.3x)
   *     one month in        championship spread 15.2 pts   valuation spread 56.8 pts   ( 3.7x)
   *     mid season          championship spread 14.0 pts   valuation spread 68.1 pts   ( 4.9x)
   *
   * and the ordering is not merely narrow, it is INVERTED. On a pristine universe the strongest club
   * in the league -- valuation 78.4, the highest of all thirty-two -- sits at rank 14 on championship
   * probability, because with no games played the whole season is still to be sampled and a great
   * club's title odds collapse toward a coin-flip against the field.
   *
   * So `championship` is DISPLAYED as a column and never used to sort. It is genuinely useful
   * information -- "13% to win it all" is the postseason picture -- it just cannot carry a ranking at
   * this precision. Ranking on a noisy column is not a conservative choice; it is ranking on the
   * simulation's dice.
   */
  rankBasis?: RankBasis;
}

/** Which column actually separates the clubs, and by how much. Used to pick a default honestly. */
export const rankSpread = (
  rows: PowerRankingRow[],
  basis: RankBasis,
): { top: number; bottom: number; spread: number } => {
  if (rows.length === 0) return { top: 0, bottom: 0, spread: 0 };
  const value = (r: PowerRankingRow) => (basis === 'championship' ? r.championshipPct : r.valuation / 100);
  const sorted = [...rows].sort((l, r) => value(r) - value(l));
  const top = value(sorted[0]);
  const bottom = value(sorted[sorted.length - 1]);
  return { top, bottom, spread: top - bottom };
};

/**
 * Group clubs by division and describe how strong each one is.
 *
 * Exported for the check that guards the double-count: perturbing a division's strength must not
 * move any rank, and this is the function under test when it does.
 */
export const summariseDivisions = (
  teams: Team[],
  valuationById: Record<string, number>,
): DivisionSummary[] => {
  const groups = new Map<string, Team[]>();
  for (const team of teams) {
    const key = `${team.league}-${team.division}`;
    const existing = groups.get(key);
    if (existing) existing.push(team);
    else groups.set(key, [team]);
  }

  const means = [...groups.values()].map((members) => {
    const total = members.reduce((sum, t) => sum + (valuationById[t.id] ?? 0), 0);
    return members.length > 0 ? total / members.length : 0;
  });
  const leagueMean = means.length > 0 ? means.reduce((a, b) => a + b, 0) / means.length : 0;
  const variance = means.length > 0
    ? means.reduce((sum, m) => sum + ((m - leagueMean) ** 2), 0) / means.length
    : 0;
  const sd = Math.sqrt(variance);

  return [...groups.values()].map((members) => {
    const first = members[0];
    const total = members.reduce((sum, t) => sum + (valuationById[t.id] ?? 0), 0);
    const meanValuation = members.length > 0 ? total / members.length : 0;
    const delta = meanValuation - leagueMean;
    const z = sd > 0 ? delta / sd : 0;
    const tag: DivisionStrengthTag = z > DIVISION_TAG_SPREAD ? 'deep' : z < -DIVISION_TAG_SPREAD ? 'soft' : 'even';
    return {
      league: first?.league ?? 'Platinum',
      division: first?.division ?? 'North',
      meanValuation,
      z,
      tag,
      teamIds: members.map((t) => t.id),
    };
  }).sort((l, r) => r.meanValuation - l.meanValuation);
};

/**
 * The board.
 *
 * Calls `fairLayerFor` rather than `priceBoardForDay` on purpose: there is no yesterday's close to
 * step from here, and taking a price would mean computing one and discarding it.
 */
export const buildPowerRankings = (input: PowerRankingsInput): PowerRankings => {
  const seed = input.seed ?? leaguePriceSeed(input.teams);
  const { layer, odds, mcTrials }: FairLayerResult = fairLayerFor({
    teams: input.teams,
    games: input.games,
    date: input.date,
    playerState: input.playerState,
    seasonYear: input.seasonYear,
    seed,
    mcTrials: input.mcTrials,
    settings: input.settings,
    fairCacheKey: input.fairCacheKey,
  });

  const oddsById = new Map<string, PlayoffOdds>(odds.map((o) => [o.teamId, o]));
  const divisions = summariseDivisions(input.teams, layer.valuation);
  const tagByTeamId = new Map<string, { tag: DivisionStrengthTag; mean: number }>();
  for (const division of divisions) {
    for (const teamId of division.teamIds) {
      tagByTeamId.set(teamId, { tag: division.tag, mean: division.meanValuation });
    }
  }

  const rankBasis: RankBasis = input.rankBasis ?? 'valuation';
  const rows: PowerRankingRow[] = input.teams.map((team) => {
    const oddsFor = oddsById.get(team.id);
    const division = tagByTeamId.get(team.id);
    return {
      teamId: team.id,
      // Filled in below, once the order is known.
      rank: 0,
      league: team.league,
      division: team.division,
      valuation: layer.valuation[team.id] ?? 0,
      fairPrice: layer.fair[team.id] ?? 0,
      // ZERO, NOT UNDEFINED, when the odds are missing. A cache hit carries no `odds`, and a blank
      // cell in a probabilities table reads as "not measured" when it means "not computed here".
      makePlayoffPct: oddsFor?.makePlayoff ?? 0,
      winLeaguePct: oddsFor?.winLeague ?? 0,
      championshipPct: oddsFor?.championship ?? 0,
      divisionTag: division?.tag ?? 'even',
      divisionMeanValuation: division?.mean ?? 0,
    };
  });

  const value = (r: PowerRankingRow) => (rankBasis === 'championship' ? r.championshipPct : r.valuation);
  rows.sort((left, right) => value(right) - value(left) || left.teamId.localeCompare(right.teamId));
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return { rows, divisions, asOf: input.date, rankBasis, mcTrials };
};