import type {
  Game,
  LeaguePlayerState,
  PendingTradeProposal,
  SeasonHistoryEntry,
  SimulationSettings,
  Team,
} from '../types';
import { PRICE_MAX, PRICE_MIN, PRICE_SANITY_MAX, type PriceSeries } from '../lib/analytics/sharePrice';
import type { DraftClassState, DraftHistoryEntry } from './draftLogic';
import { auditRosterInvariants } from './rosterManagement';

export const LOCAL_UNIVERSE_FORMAT = 'gpb_local_universe_state';
export const LOCAL_UNIVERSE_VERSION = 1;

export type LocalOffseasonStage =
  | 'idle'
  | 'awards'
  | 'retirements'
  | 'draft_lottery'
  | 'draft'
  | 'free_agency'
  | 'start_next_season';

export interface LocalOffseasonWorkflow {
  seasonYear: number | null;
  stage: LocalOffseasonStage;
}

export interface LocalDraftCenterState {
  activeClass: DraftClassState | null;
  history: DraftHistoryEntry[];
}

/**
 * Running tally of what the headliner newsroom has filed.
 *
 * PRESENTATION STATE, NOT SIMULATION STATE. It must never feed back into the engine:
 * if a saved headline count changed a simulated outcome, then reloading a save would
 * produce a different season from the same games, which breaks the one property this
 * whole project has been careful about.
 *
 * It lives on the bundle rather than inside `Game` or `Player` because those
 * serialize per row to Supabase, and inflating a per-row schema for a statistic that
 * only ever renders a number in a corner is the wrong trade.
 */
export interface HeadlinerLedger {
  /** Impressions the columnist has spent. Capped in a season by the pipeline. */
  tombuccelliImpressions: number;
  /** Anything the columnist has filed at all, praise or otherwise. */
  tombuccelliArticles: number;
  sooDebutsCovered: number;
  gatzArticles: number;
}

export const EMPTY_HEADLINER_LEDGER: HeadlinerLedger = {
  tombuccelliImpressions: 0,
  tombuccelliArticles: 0,
  sooDebutsCovered: 0,
  gatzArticles: 0,
};

/**
 * Read a ledger defensively.
 *
 * The field is optional because it did not exist when these saves were written, and
 * every save in the wild lacks it. Reading it as "absent means zero" rather than
 * failing is what makes the addition need no migration: an old bundle loads, and the
 * newsroom starts its season from nothing.
 *
 * Non-finite or negative numbers are also treated as zero rather than propagated. The
 * field is a cap input, and a corrupted cap that permits unlimited impressions would
 * quietly remove the columnist's entire character.
 */
export const readHeadlinerLedger = (value: unknown): HeadlinerLedger => {
  if (!isRecord(value)) return { ...EMPTY_HEADLINER_LEDGER };
  const count = (key: keyof HeadlinerLedger): number => {
    const raw = value[key];
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;
  };
  return {
    tombuccelliImpressions: count('tombuccelliImpressions'),
    tombuccelliArticles: count('tombuccelliArticles'),
    sooDebutsCovered: count('sooDebutsCovered'),
    gatzArticles: count('gatzArticles'),
  };
};

/**
 * The HXSE share-price closes for a league, newest last.
 *
 * Optional and additive, exactly as `headlinerLedger` is: absence means a league that never traded,
 * not a broken one, and every existing save loads without a migration script.
 *
 * Deliberately NOT stored inside `Game[]` or on `Team`. Both of those serialize per row to
 * Supabase, and a per-day-per-club price is a presentation concern -- inflating a per-row schema
 * with 32 numbers a day for something derived would be the wrong trade.
 */
export type SharePriceLedger = PriceSeries[];

/**
 * Read the price ledger defensively.
 *
 * Every field is checked rather than trusted, and a malformed day is DROPPED rather than repaired.
 * The difference matters: a repaired day invents a price nobody traded at, and this ledger is the
 * record of what the market did. Dropping it leaves a gap, which is honest, and the series simply
 * resumes from the last good day.
 *
 * Non-finite closes are dropped for the same reason -- a NaN would put a number on a chart that no
 * price path could have produced. Out-of-band closes are tested against `PRICE_SANITY_MAX` rather
 * than `PRICE_MAX`, because a price is allowed to exceed its own fair value and a reader that
 * discarded those would be destroying real data invisibly.
 */
/**
 * The recorded fair layer of one day, if it survived intact enough to draw.
 *
 * A fair value outside `[PRICE_MIN, PRICE_MAX]` means the save is corrupt, and coercing it would put
 * a valuation on the chart that no fair layer could have produced. This is NOT the same rule as the
 * closes, deliberately: fair value has a real ceiling at $1,000 because that is the top of the
 * valuation scale, while a close may sit above it as a premium. The difference is what happens to a
 * day whose closes are fine.
 *
 * The closes are the market's record and are kept. A bad fair layer is DROPPED on its own, leaving
 * that one day without a second line rather than dropping the day or inventing a valuation for it.
 * A chart with a gap in its fair line is honest; a chart with a flat fair line through a corrupt day
 * is not.
 *
 * Returns `{}` rather than `undefined` when there is nothing usable, so the spread in the caller
 * resolves to no `fair` key and the day simply has none.
 */
const readRecordedFair = (value: unknown): { fair?: Record<string, number> } => {
  if (!isRecord(value)) return {};
  const fair: Record<string, number> = {};
  let any = false;
  for (const [teamId, raw] of Object.entries(value)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    if (raw < PRICE_MIN || raw > PRICE_MAX) continue;
    fair[teamId] = raw;
    any = true;
  }
  return any ? { fair } : {};
};

export const readSharePriceLedger = (value: unknown): SharePriceLedger => {
  if (!Array.isArray(value)) return [];
  const out: PriceSeries[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const date = entry.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!isRecord(entry.close)) continue;
    const close: Record<string, number> = {};
    let any = false;
    for (const [teamId, raw] of Object.entries(entry.close)) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      /*
        CLOSES ARE TESTED AGAINST THE SANITY GUARD, NOT `PRICE_MAX`.

        This test used to reject anything above $1,000, which was correct while the close was clamped
        there -- and would have silently DESTROYED data the moment the clamp was lifted. A reader
        that discards legitimate prices is worse than one that accepts a few impossible ones, because
        the discard is invisible: the chart simply shows a shorter history and nothing says why.

        The fair layer below is still tested against `PRICE_MAX`, and must stay so. Fair value has a
        real ceiling at $1,000 because that is the top of the valuation scale; a stored fair value
        above it means the save is genuinely corrupt rather than merely surprising.
      */
      if (raw < PRICE_MIN || raw > PRICE_SANITY_MAX) continue;
      close[teamId] = raw;
      any = true;
    }
    // A day where every club was corrupt carries no information. Keeping it as an empty object
    // would read downstream as "the market was shut", which is a claim this save cannot support.
    if (any) out.push({ date, close, ...readRecordedFair(entry.fair) });
  }
  // Ascending by date, so callers can treat the last entry as today without sorting. Duplicates are
  // collapsed to the LAST occurrence, because a re-saved day is more recent than the one it replaced.
  const byDate = new Map<string, PriceSeries>();
  out.forEach((day) => byDate.set(day.date, day));
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

export interface LocalUniverseBundle {
  format: typeof LOCAL_UNIVERSE_FORMAT;
  version: typeof LOCAL_UNIVERSE_VERSION;
  exportedAt: string;
  league: {
    teams: Team[];
    settings: SimulationSettings;
    games: Game[];
    currentDate: string;
    progress: number;
    seasonComplete: boolean;
  };
  players: LeaguePlayerState;
  seasonHistory: SeasonHistoryEntry[];
  offseasonWorkflow: LocalOffseasonWorkflow;
  draftCenter: LocalDraftCenterState;
  pendingTrades: PendingTradeProposal[];
  /**
   * Optional and additive, so no migration script is needed and every existing save
   * loads cleanly. Absence means an untouched season, not a broken one.
   */
  headlinerLedger?: HeadlinerLedger;
  /**
   * HXSE share-price closes. Optional and additive, so no migration script is needed and every
   * existing save loads cleanly. Absence means the market has not traded yet.
   */
  sharePriceLedger?: SharePriceLedger;
}

export interface LocalUniverseValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const pushError = (errors: string[], condition: boolean, message: string): void => {
  if (!condition) errors.push(message);
};

const validateSettings = (settings: unknown, errors: string[]): settings is SimulationSettings => {
  if (!isRecord(settings)) {
    errors.push('League settings must be an object.');
    return false;
  }

  const fields: Array<keyof SimulationSettings> = [
    'continuityWeight',
    'winLossVariance',
    'homeFieldAdvantage',
    'gameLuckFactor',
    'leagueEnvironmentBalance',
    'battingVarianceFactor',
  ];
  fields.forEach((field) => pushError(errors, isFiniteNumber(settings[field]), `Setting ${field} must be a finite number.`));
  return errors.length === 0;
};

const validateTeams = (teams: unknown, errors: string[]): teams is Team[] => {
  if (!Array.isArray(teams) || teams.length !== 32) {
    errors.push('The universe must contain exactly 32 teams.');
    return false;
  }

  const teamIds = teams.map((team) => (isRecord(team) && typeof team.id === 'string' ? team.id : ''));
  if (teamIds.some((teamId) => teamId.length === 0)) errors.push('Every team must have a non-empty ID.');
  if (new Set(teamIds).size !== teamIds.length) errors.push('Team IDs must be unique.');
  return errors.length === 0;
};

const validateGames = (games: unknown, teamIds: Set<string>, errors: string[]): games is Game[] => {
  if (!Array.isArray(games)) {
    errors.push('League games must be an array.');
    return false;
  }

  const gameIds = new Set<string>();
  games.forEach((game, index) => {
    if (!isRecord(game)) {
      errors.push(`Game ${index} must be an object.`);
      return;
    }
    const gameId = typeof game.gameId === 'string' ? game.gameId : '';
    if (!gameId) errors.push(`Game ${index} is missing gameId.`);
    if (gameIds.has(gameId)) errors.push(`Duplicate game ID: ${gameId}.`);
    gameIds.add(gameId);
    if (typeof game.homeTeam !== 'string' || !teamIds.has(game.homeTeam)) errors.push(`Game ${gameId} references an invalid home team.`);
    if (typeof game.awayTeam !== 'string' || !teamIds.has(game.awayTeam)) errors.push(`Game ${gameId} references an invalid away team.`);
    if (game.homeTeam === game.awayTeam) errors.push(`Game ${gameId} has the same home and away team.`);
    if (game.status !== 'scheduled' && game.status !== 'completed') errors.push(`Game ${gameId} has an invalid status.`);
    if (game.phase !== 'regular_season' && game.phase !== 'playoffs') errors.push(`Game ${gameId} has an invalid phase.`);
    if (!isRecord(game.score) || !isFiniteNumber(game.score.home) || !isFiniteNumber(game.score.away)) errors.push(`Game ${gameId} has an invalid score.`);
  });
  return errors.length === 0;
};

const validatePlayers = (players: unknown, errors: string[]): players is LeaguePlayerState => {
  if (!isRecord(players)) {
    errors.push('Player state must be an object.');
    return false;
  }

  const fields: Array<keyof LeaguePlayerState> = [
    'players',
    'battingStats',
    'pitchingStats',
    'battingRatings',
    'pitchingRatings',
    'rosterSlots',
    'transactions',
  ];
  fields.forEach((field) => pushError(errors, Array.isArray(players[field]), `Player state field ${field} must be an array.`));
  if (!Array.isArray(players.players)) return false;

  const playerIds = players.players.map((player) => (isRecord(player) && typeof player.playerId === 'string' ? player.playerId : ''));
  if (playerIds.some((playerId) => playerId.length === 0)) errors.push('Every player must have a non-empty playerId.');
  if (new Set(playerIds).size !== playerIds.length) errors.push('Player IDs must be unique.');
  return errors.length === 0;
};

export const validateLocalUniverseBundle = (value: unknown): LocalUniverseValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(value)) {
    return { valid: false, errors: ['Universe bundle must be an object.'], warnings };
  }
  if (value.format !== LOCAL_UNIVERSE_FORMAT) errors.push('Unsupported local universe format.');
  if (value.version !== LOCAL_UNIVERSE_VERSION) errors.push('Unsupported local universe version.');
  if (typeof value.exportedAt !== 'string' || value.exportedAt.length === 0) errors.push('Universe bundle is missing exportedAt.');

  const playersValid = validatePlayers(value.players, errors);

  const league = isRecord(value.league) ? value.league : null;
  if (!league) {
    errors.push('Universe bundle is missing league state.');
  } else {
    const teamsValid = validateTeams(league.teams, errors);
    validateSettings(league.settings, errors);
    const teamIds = new Set(
      Array.isArray(league.teams)
        ? league.teams.flatMap((team) => (isRecord(team) && typeof team.id === 'string' ? [team.id] : []))
        : [],
    );
    validateGames(league.games, teamIds, errors);
    if (typeof league.currentDate !== 'string' || league.currentDate.length === 0) errors.push('Current date must be a non-empty string.');
    if (!isFiniteNumber(league.progress) || league.progress < 0 || league.progress > 100) errors.push('League progress must be between 0 and 100.');
    if (typeof league.seasonComplete !== 'boolean') errors.push('Season completion must be boolean.');
    if (teamsValid && playersValid) {
      const playerState = value.players as LeaguePlayerState;
      const rosterAudit = auditRosterInvariants(playerState, league.teams as Team[]);
      if (!rosterAudit.isValid) errors.push(`Roster invariant failed with ${rosterAudit.totalViolations} violation${rosterAudit.totalViolations === 1 ? '' : 's'}.`);
    }
  }

  if (!playersValid) {
    warnings.push('Roster relationship checks were skipped because player state is malformed.');
  }
  if (!Array.isArray(value.seasonHistory)) errors.push('Season history must be an array.');
  if (!Array.isArray(value.pendingTrades)) errors.push('Pending trades must be an array.');
  if (!isRecord(value.offseasonWorkflow)) errors.push('Offseason workflow must be an object.');
  if (!isRecord(value.draftCenter)) errors.push('Draft center state must be an object.');

  // Optional and additive: absence is not an error, because every save written before
  // the newsroom existed lacks it and refusing to load those would be a worse outcome
  // than starting their season from zero. Only a PRESENT but malformed ledger is
  // worth a warning, and it is a warning rather than an error because the reader
  // already substitutes zeros.
  if (value.headlinerLedger !== undefined && !isRecord(value.headlinerLedger)) {
    warnings.push('Headliner ledger is not an object; the newsroom will start from zero.');
  }

  // Same reasoning as the newsroom ledger: a PRESENT but malformed price ledger is worth a warning
  // and not an error, because `readSharePriceLedger` drops the bad days and keeps the good ones.
  // Refusing to load a whole league over a corrupt price would be a far worse outcome than a chart
  // with a gap in it, so this warns.
  if (value.sharePriceLedger !== undefined && !Array.isArray(value.sharePriceLedger)) {
    warnings.push('Share price ledger is not an array; the market will start from no history.');
  }

  return { valid: errors.length === 0, errors, warnings };
};

export const createLocalUniverseBundle = (input: Omit<LocalUniverseBundle, 'format' | 'version' | 'exportedAt'>): LocalUniverseBundle => ({
  format: LOCAL_UNIVERSE_FORMAT,
  version: LOCAL_UNIVERSE_VERSION,
  exportedAt: new Date().toISOString(),
  ...input,
  // AFTER the input spread, deliberately. A caller that passes an explicit
  // `headlinerLedger: undefined` would otherwise overwrite the seeded default with
  // undefined, and the save would carry a missing field it was supposed to have.
  headlinerLedger: { ...EMPTY_HEADLINER_LEDGER, ...(input.headlinerLedger ?? {}) },
  // Same reasoning, opposite default. The newsroom ledger has a meaningful empty state, so it is
  // seeded. The price ledger's meaningful empty state IS an empty array, so `?? []` is the honest
  // default rather than a seeded zero -- and going through the reader means a malformed ledger
  // passed by a caller is sanitised on the way in rather than on the way out.
  sharePriceLedger: readSharePriceLedger(input.sharePriceLedger),
});
