import React from 'react';
import {
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  type Game,
  type Player,
  type PlayerBattingRatings,
  type PlayerPitchingRatings,
  type PlayerSeasonBatting,
  type PlayerSeasonPitching,
  RESERVE_ROSTER_SLOTS,
  STARTING_PITCHER_SLOTS,
  type Team,
} from '../../types';
import { fmtAvg, fmtEra, fmtPct, fmtRecord, fmtWhip } from '../../logic/statFormatting';
import { toBattingCounts } from '../../lib/analytics/metrics';
import { leagueBaseline, wrcPlus, type LeagueBaseline, type WrcPlusResult } from '../../lib/analytics/wrcPlus';
import { Panel, StatValue } from '../ui';

/**
 * Shared helpers and compositions for the club screens.
 *
 * TeamsHub was 1,206 lines holding six panels and two inline SVG gauges. The
 * gauges were near-identical copies of each other with different radii and
 * viewBoxes, which is why they are one primitive now.
 */

export type TeamRosterEntry = {
  slotCode: string;
  overall: number;
  potentialOverall: number;
  player: Player;
  battingStat: PlayerSeasonBatting | null;
  pitchingStat: PlayerSeasonPitching | null;
  battingRatings: PlayerBattingRatings | null;
  pitchingRatings: PlayerPitchingRatings | null;
};

export const ROSTER_DISPLAY_ORDER = [
  ...BATTING_ROSTER_SLOTS,
  ...STARTING_PITCHER_SLOTS,
  ...BULLPEN_ROSTER_SLOTS,
  ...RESERVE_ROSTER_SLOTS,
];

/** Full roster: batting (9) + starting rotation (5) + bullpen (5) + bench (10) = 29 slots */
export const ROSTER_STRENGTH_SLOT_COUNT =
  BATTING_ROSTER_SLOTS.length +
  STARTING_PITCHER_SLOTS.length +
  BULLPEN_ROSTER_SLOTS.length +
  RESERVE_ROSTER_SLOTS.length;

export const formatRosterSlotLabel = (slotCode: string): string =>
  slotCode.startsWith('BN') ? `Bench ${slotCode.slice(2)}` : slotCode;

export const recordOf = (team: Team): string => fmtRecord(team.wins, team.losses);
export const winPctOf = (team: Team): string => fmtPct(team.wins + team.losses > 0 ? team.wins / (team.wins + team.losses) : 0);
export const runDiffOf = (team: Team): number => team.runsScored - team.runsAllowed;

const hashKey = (input: string): number => {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 2147483647;
  }
  return hash;
};

const getFallbackHits = (game: Game, side: 'away' | 'home'): number => {
  const runs = side === 'away' ? game.score.away : game.score.home;
  return runs + 3 + (hashKey(`${game.gameId}:${side}:team-hits`) % 5);
};

/**
 * Team hits, summed from completed games.
 *
 * Games recorded before per-team hit totals existed have none stored, so a
 * value is derived deterministically from the score and the game id. It is
 * stable for a given game and therefore stable across renders, but it is a
 * stand-in, not a recorded statistic. Preserved as-is because the roster
 * contact figure depends on it and inventing a different number here would
 * silently change what the screen reports.
 */
export const getHitsForTeam = (teamId: string, games: Game[]): number =>
  games.reduce((total, game) => {
    if (game.status !== 'completed') {
      return total;
    }
    if (game.awayTeam === teamId) {
      const awayHits = game.stats.awayHits;
      return total + (typeof awayHits === 'number' && awayHits > 0 ? awayHits : getFallbackHits(game, 'away'));
    }
    if (game.homeTeam === teamId) {
      const homeHits = game.stats.homeHits;
      return total + (typeof homeHits === 'number' && homeHits > 0 ? homeHits : getFallbackHits(game, 'home'));
    }
    return total;
  }, 0);

export const compareStandings = (left: Team, right: Team): number => {
  const leftGames = left.wins + left.losses;
  const rightGames = right.wins + right.losses;
  const leftPct = leftGames === 0 ? 0 : left.wins / leftGames;
  const rightPct = rightGames === 0 ? 0 : right.wins / rightGames;

  if (leftPct !== rightPct) return rightPct - leftPct;

  const leftDiff = runDiffOf(left);
  const rightDiff = runDiffOf(right);
  if (leftDiff !== rightDiff) return rightDiff - leftDiff;

  if (left.wins !== right.wins) return right.wins - left.wins;

  return left.city.localeCompare(right.city);
};

export const ordinal = (rank: number): string =>
  `${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'}`;

export const describeTeam = (team: Team, divisionRank: number, leagueRank: number): string => {
  const diff = runDiffOf(team);
  const profile =
    diff >= 25
      ? 'driven by a high-output attack and clean run prevention'
      : diff <= -25
        ? 'still searching for traction on both sides of the ball'
        : 'staying competitive through tight game management';

  return `${team.city} ${team.name} compete in the ${team.division} Division of the ${team.league} League, currently sitting ${ordinal(divisionRank)} in the division and ${ordinal(leagueRank)} in the league, ${profile}.`;
};

export const formatGameLabel = (game: Game, selectedTeamId: string, teamsById: Map<string, Team>): string => {
  const opponentId = game.awayTeam === selectedTeamId ? game.homeTeam : game.awayTeam;
  const opponent = teamsById.get(opponentId);
  const marker = game.awayTeam === selectedTeamId ? '@' : 'vs';
  return `${marker} ${opponent ? `${opponent.city} ${opponent.name}` : opponentId.toUpperCase()}`;
};

/* ---- batting order generation, carried over unchanged ---- */

const scoreBattingOrderEntry = (entry: TeamRosterEntry, slot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): number => {
  const ratings = entry.battingRatings;
  if (!ratings) return -1;
  if (slot === 3) return ratings.contact * 0.5 + ratings.power * 0.5;
  if (slot === 4) return ratings.power * 0.7 + ratings.contact * 0.3;
  if (slot === 1) return ratings.speed * 0.4 + ratings.plateDiscipline * 0.3 + ratings.contact * 0.3;
  if (slot === 2) return ratings.contact * 0.5 + ratings.avoidStrikeout * 0.3 + ratings.speed * 0.2;
  if (slot === 5) return ratings.power * 0.6 + ratings.contact * 0.4;
  return ratings.contact + ratings.power + ratings.plateDiscipline;
};

export const generateBattingOrder = (startingNine: TeamRosterEntry[]): TeamRosterEntry[] => {
  const available = [...startingNine].filter((entry) => entry.battingRatings);
  const ordered: Array<TeamRosterEntry | null> = Array(9).fill(null);

  const prioritySlots: Array<1 | 2 | 3 | 4 | 5> = [3, 4, 1, 2, 5];
  prioritySlots.forEach((slot) => {
    if (available.length === 0) return;
    let bestIndex = 0;
    let bestScore = scoreBattingOrderEntry(available[0], slot);
    for (let index = 1; index < available.length; index += 1) {
      const candidateScore = scoreBattingOrderEntry(available[index], slot);
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestIndex = index;
      }
    }
    const [chosen] = available.splice(bestIndex, 1);
    ordered[slot - 1] = chosen;
  });

  available
    .sort((left, right) => scoreBattingOrderEntry(right, 6) - scoreBattingOrderEntry(left, 6) || right.overall - left.overall)
    .forEach((entry, index) => {
      const slotIndex = 5 + index;
      if (slotIndex < ordered.length) ordered[slotIndex] = entry;
    });

  return ordered.filter((entry): entry is TeamRosterEntry => entry !== null);
};

/* ---- overall tiers ---- */

export const getRosterStrengthTier = (overall: number | null): string => {
  if (overall === null) return 'Awaiting Data';
  if (overall >= 83.5) return 'Dynasty';
  if (overall >= 82) return 'Elite';
  if (overall >= 80.5) return 'Competitive';
  if (overall >= 79) return 'Fringe';
  return 'Rebuilding';
};

/** Elite reads gold, solid reads ink, and everything else recedes. */
export const overallVariant = (overall: number | null): 'accent' | 'default' | 'neg' => {
  if (overall === null) return 'neg';
  if (overall >= 88) return 'accent';
  if (overall >= 80) return 'default';
  return 'neg';
};

/**
 * Single-line header. No eyebrow, for the same reason as HomePanel.
 *
 * `accent` paints a club-colour rule down the panel's left edge. Two deliberate properties:
 *
 * It is OUTSIDE the panel box, not inside it, so it takes no space from the content and cannot
 * shift a column -- the standing "decoration must never go inside a table" guardrail and the 38px
 * chrome-bar rule are both untouched by it.
 *
 * It is drawn with a `::before` on the panel's own box rather than as a child element, because the
 * panel carries `overflow-hidden` and a positioned child would be a second thing to keep inside the
 * clip. One box, one pseudo-element.
 *
 * The colour must arrive already resolved -- `clubInk(team.id).hex`, never the raw hex from
 * `teamColors`. Three clubs' primaries sit below 1.2:1 on this surface and would draw nothing.
 */
export const ClubPanel: React.FC<{
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
  /** Resolved club colour from `clubInk`, not a raw palette hex. */
  accent?: string | null;
}> = ({ title, aside, children, bodyClassName = 'p-4', className = '', accent }) => (
  <Panel
    className={`overflow-hidden ${accent ? 'club-accent' : ''} ${className}`}
    {...(accent ? { style: { '--club-accent': accent } as React.CSSProperties } : {})}
  >
    <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
      <h2 className="t-h3 min-w-0 truncate">{title}</h2>
      {aside}
    </div>
    <div className={bodyClassName}>{children}</div>
  </Panel>
);

export const StatTile: React.FC<{
  label: string;
  value: string | number;
  detail?: React.ReactNode;
  accent?: boolean;
}> = ({ label, value, detail, accent }) => (
  <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
    <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
    <p className="t-stat-lg mt-1 truncate">{value}</p>
    {detail && <p className="t-caption mt-0.5 truncate text-[var(--color-ink-faint)]">{detail}</p>}
  </div>
);

/** Compact two-column stat list, used for player batting and pitching lines. */
export const StatList: React.FC<{ rows: Array<[string, string]> }> = ({ rows }) => (
  <dl className="flex flex-col">
    {rows.map(([label, value]) => (
      <div key={label} className="flex items-baseline justify-between gap-3 border-b border-[var(--color-chrome-lo)] py-1 last:border-b-0">
        <dt className="t-caption text-[var(--color-ink-faint)]">{label}</dt>
        <dd><StatValue size="sm">{value}</StatValue></dd>
      </div>
    ))}
  </dl>
);

export const EMPTY = '---';

/**
 * The league a run value is measured against.
 *
 * Built from the SAME rows the cards display, not from a re-derived filter. The
 * card shows whichever row `getPreferredBattingStatsByPlayerId` picks -- the latest
 * season, preferring regular season, falling back to another phase when a player
 * has only that one -- so a baseline computed any other way could score a player
 * against a league they are not shown in. Deriving both from one map makes that
 * impossible.
 *
 * Players below the variance floor are still pooled into the league rate, because
 * that average is weighted by plate appearance and a small row barely moves it;
 * excluding them would make the league figure jump as individuals crossed the
 * floor. `leagueBaseline` applies the floor only where it belongs, to the spread.
 */
export const runValueBaseline = (
  preferredByPlayerId: ReadonlyMap<string, PlayerSeasonBatting>,
): LeagueBaseline | null =>
  leagueBaseline(
    Array.from(preferredByPlayerId.values())
      .filter((stat) => stat.plateAppearances > 0)
      .map(toBattingCounts),
  );

const playerWrc = (
  stat: PlayerSeasonBatting | null,
  baseline: LeagueBaseline | null,
): WrcPlusResult | null => {
  if (!stat || !baseline) return null;
  return wrcPlus(toBattingCounts(stat), baseline);
};

export interface BattingCardContent {
  rows: Array<[string, string]>;
  /**
   * One line of context for the wRC+ figure, or null when there is nothing to say.
   *
   * This is the whole reason run value lives on a card rather than a leaderboard.
   * Measured over 90 days, the top ten wRC+ values span 4.0 points and give 5
   * distinct whole numbers from 10 rows -- a ranked board of them reports noise in
   * its own units. On a card the reader is looking at one player, so the figure can
   * sit beside what it was before the correction and how much of it survived, which
   * is the part a board has nowhere to put.
   */
  runValueNote: string | null;
}

/**
 * The batting line, with run value folded in beside the rate stats, plus its caveat.
 *
 * wOBA and wRC+ sit with AVG and OPS rather than in a panel of their own, because
 * they answer the same question those two answer and a reader looking at a hitter
 * expects to find them there. Rates first, then run value, then the counts.
 *
 * wRC+ is rounded to a whole number. That is not laziness: the top ten hitters span
 * 4.0 points and produce 5 distinct integers from 10 rows, so a decimal would imply
 * a precision the measurement does not have. The note carries the raw figure so the
 * size of the shrinkage stays visible.
 *
 * Rows and note come back together from one call, because both are derived from the
 * same wRC+ and computing it twice to render one card was the shape of bug this
 * file has been bitten by before.
 */
export const battingCardContent = (
  stat: PlayerSeasonBatting | null,
  baseline: LeagueBaseline | null,
): BattingCardContent => {
  const wrc = playerWrc(stat, baseline);

  const rows: Array<[string, string]> = [
    ['AVG', stat ? fmtAvg(stat.avg) : EMPTY],
    ['OPS', stat ? stat.ops.toFixed(3) : EMPTY],
    // wOBA is a rate on this league's runs-per-plate-appearance scale, so it reads
    // near .146 rather than a baseball-conventional .320. The leading dot matches
    // AVG and SLG beside it; the magnitude is on this engine's scale, which is what
    // woba.ts documents.
    ['wOBA', wrc?.woba != null ? fmtAvg(wrc.woba) : EMPTY],
    ['wRC+', wrc?.value != null ? String(Math.round(wrc.value)) : EMPTY],
    ['AB', stat ? String(stat.atBats) : EMPTY],
    ['H', stat ? String(stat.hits) : EMPTY],
    ['HR', stat ? String(stat.homeRuns) : EMPTY],
    ['RBI', stat ? String(stat.rbi) : EMPTY],
  ];

  const runValueNote =
    wrc && wrc.value !== null && wrc.rawValue !== null && wrc.shrinkageWeight !== null
      ? `100 is league average. Shrunk toward average: ${Math.round(wrc.rawValue)} ` +
        `unshrunk, ${Math.round(wrc.shrinkageWeight * 100)}% trusted.`
      : null;

  return { rows, runValueNote };
};

export const pitchingLineRows = (stat: PlayerSeasonPitching | null): Array<[string, string]> => [
  ['ERA', stat ? fmtEra(stat.era) : EMPTY],
  ['WHIP', stat ? fmtWhip(stat.whip) : EMPTY],
  ['W-L', stat ? fmtRecord(stat.wins, stat.losses) : EMPTY],
  ['K', stat ? String(stat.strikeouts) : EMPTY],
  ['IP', stat ? String(stat.inningsPitched) : EMPTY],
];
