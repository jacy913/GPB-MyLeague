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

export const ROSTER_STRENGTH_SLOT_COUNT = BATTING_ROSTER_SLOTS.length + STARTING_PITCHER_SLOTS.length;

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
  if (overall >= 88) return 'Elite Core';
  if (overall >= 82) return 'Strong Core';
  if (overall >= 76) return 'Competitive';
  return 'Rebuilding';
};

/** Elite reads gold, solid reads ink, and everything else recedes. */
export const overallVariant = (overall: number | null): 'accent' | 'default' | 'neg' => {
  if (overall === null) return 'neg';
  if (overall >= 88) return 'accent';
  if (overall >= 80) return 'default';
  return 'neg';
};

/** Single-line header. No eyebrow, for the same reason as HomePanel. */
export const ClubPanel: React.FC<{
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
}> = ({ title, aside, children, bodyClassName = 'p-4', className = '' }) => (
  <Panel className={`overflow-hidden ${className}`}>
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
  detail?: string;
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

export const battingLineRows = (stat: PlayerSeasonBatting | null): Array<[string, string]> => [
  ['AVG', stat ? fmtAvg(stat.avg) : EMPTY],
  ['OPS', stat ? stat.ops.toFixed(3) : EMPTY],
  ['AB', stat ? String(stat.atBats) : EMPTY],
  ['H', stat ? String(stat.hits) : EMPTY],
  ['HR', stat ? String(stat.homeRuns) : EMPTY],
  ['RBI', stat ? String(stat.rbi) : EMPTY],
];

export const pitchingLineRows = (stat: PlayerSeasonPitching | null): Array<[string, string]> => [
  ['ERA', stat ? fmtEra(stat.era) : EMPTY],
  ['WHIP', stat ? fmtWhip(stat.whip) : EMPTY],
  ['W-L', stat ? fmtRecord(stat.wins, stat.losses) : EMPTY],
  ['K', stat ? String(stat.strikeouts) : EMPTY],
  ['IP', stat ? String(stat.inningsPitched) : EMPTY],
];
