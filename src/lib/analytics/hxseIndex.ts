/**
 * The HXSE indices: one composite, four divisions, two leagues.
 *
 * WHY AN INDEX EXISTS AT ALL
 *
 * Without one, "did this team go up" is unanswerable. A club can rise because it got better and
 * a league can fall because everyone got worse, and those are different facts that a bare share
 * price cannot tell apart. The index is what makes "my team outperformed the league" a statement
 * with a meaning.
 *
 * VALUE-WEIGHTED, NOT EQUAL-WEIGHTED, and that is the whole design
 *
 * An equal-weighted index asks a 61-win club and a 61-win club to count the same however much
 * each is worth, which is not an index, it is an average of teams. A value-weighted index weights
 * each club by its own value, so a big club moving 3% moves the index more than a small club
 * moving 3% -- which is how real indices behave and is what makes the comparison meaningful.
 *
 * THE MEASUREMENT THAT PROVES IT, and it is asserted in `checkHxseIndex`
 *
 * Shuffle one large club's value by 10% and leave every other club alone. Under equal weighting
 * the index moves by 10/32 of that. Under value weighting it moves by that club's SHARE. The
 * check requires the observed move to match the share and not the flat average, so "did someone
 * accidentally write an equal-weighted index" is a failing test rather than a matter of taste.
 *
 * IT IS A LEVEL, NOT A RETURN
 *
 * The composite here is a valuation level, not an indexed-to-100 time series. A price series
 * against a base belongs in `Phase 2`, and building one now would be a number with no history
 * behind it.
 *
 * WHAT IT REFUSES TO DO
 *
 * It refuses to build while the playoff-probability term is missing from the value function.
 * `teamValue.ts` sets PLAYOFF_PROBABILITY_AVAILABLE = false, and the index throws rather than
 * publishing a composite that silently omits its largest input -- an index missing its biggest
 * term is not a valuation, it is a number with a confident label.
 */

import {
  PLAYOFF_PROBABILITY_AVAILABLE,
  measureLeague,
  teamValueFor,
  type TeamValueInput,
} from './teamValue';

export interface ValuedTeam {
  teamId: string;
  /** Display city, carried so the index can be reported without a second lookup. */
  city: string;
  league: 'Platinum' | 'Prestige';
  division: 'North' | 'South' | 'East' | 'West';
  value: number;
}

export interface IndexReading {
  /** The index level itself. */
  level: number;
  /** How many clubs are inside it, so a reader can judge what it averages. */
  constituents: number;
}

/**
 * Build the value for every club from its inputs.
 *
 * The league statistics are measured ONCE from the whole field, not per club. Measuring them per
 * club would give every club its own z-scores and therefore an identical 50, which is a beautiful
 * way to publish a constant.
 */
export const valueAllTeams = (inputs: TeamValueInput[], meta: Map<string, { city: string; league: 'Platinum' | 'Prestige'; division: 'North' | 'South' | 'East' | 'West' }>): ValuedTeam[] => {
  if (inputs.length === 0) return [];
  const league = measureLeague(inputs);
  return inputs.map((input) => {
    const m = meta.get(input.teamId);
    return {
      teamId: input.teamId,
      city: m?.city ?? input.teamId,
      league: m?.league ?? 'Prestige',
      division: m?.division ?? 'North',
      value: teamValueFor(input, league),
    };
  });
};

/**
 * A value-weighted index over a set of clubs.
 *
 * `level = SUM(value_i^2) / SUM(value_i)` -- each club weighted by its own value, normalised.
 *
 * The division by the sum of values is what makes it a LEVEL comparable across dates rather
 * than an arbitrary total that grows with every price move. Without it the index is just a sum
 * wearing a name.
 */
export const valueWeightedIndex = (teams: ValuedTeam[]): IndexReading => {
  if (teams.length === 0) return { level: 0, constituents: 0 };
  let weighted = 0;
  let total = 0;
  for (const t of teams) {
    weighted += t.value * t.value;
    total += t.value;
  }
  return { level: total > 0 ? weighted / total : 0, constituents: teams.length };
};

/** The same index, but equal-weighted. It exists ONLY so the check can prove we are not using it. */
export const equalWeightedIndex = (teams: ValuedTeam[]): IndexReading => {
  if (teams.length === 0) return { level: 0, constituents: 0 };
  const total = teams.reduce((a, t) => a + t.value, 0);
  return { level: total / teams.length, constituents: teams.length };
};

export interface HxseIndices {
  composite: IndexReading;
  divisions: Record<string, IndexReading>;
  leagues: Record<string, IndexReading>;
}

/**
 * Every index the blueprint asks for: one composite, four divisions, two leagues.
 *
 * Throws while the playoff-probability term is absent. See the module header for why that is a
 * throw and not a warning -- an index that omits its largest input is not a valuation, and
 * publishing one with a confident label is the specific failure this module exists to prevent.
 */
export const buildHxseIndices = (teams: ValuedTeam[]): HxseIndices => {
  if (!PLAYOFF_PROBABILITY_AVAILABLE) {
    throw new Error(
      'HXSE indices require the playoff-probability term, which is not built yet. '
      + 'teamValue.ts omits it deliberately rather than approximating it, and this index '
      + 'refuses to publish a composite that silently drops its largest input.',
    );
  }
  const divisions: Record<string, IndexReading> = {};
  for (const d of ['North', 'South', 'East', 'West']) {
    divisions[d] = valueWeightedIndex(teams.filter((t) => t.division === d));
  }
  const leagues: Record<string, IndexReading> = {};
  for (const l of ['Prestige', 'Platinum']) {
    leagues[l] = valueWeightedIndex(teams.filter((t) => t.league === l));
  }
  return { composite: valueWeightedIndex(teams), divisions, leagues };
};

/**
 * A club's weight inside the composite, as a percentage.
 *
 * Exposed because "a big club moves the index more" is only a claim until the share is a number
 * somebody can check, and `checkHxseIndex` checks exactly that.
 */
export const indexShare = (team: ValuedTeam, all: ValuedTeam[]): number => {
  const total = all.reduce((a, t) => a + t.value, 0);
  return total > 0 ? (team.value / total) * 100 : 0;
};