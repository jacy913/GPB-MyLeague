/**
 * The newsroom: five named reporters, what each will write about, and how each is
 * allowed to be chosen.
 *
 * This module holds REGISTRY DATA and the pure predicates over it. It writes no
 * prose -- template banks live in `headlinerVoices.ts` and event detection in
 * `headlinerEvents.ts` -- and it holds no portrait URLs, because `import.meta.glob`
 * is a build-time transform and an asset import in `src/logic/` would be a new
 * precedent. The profile names a `portraitKey`; `ui/HeadlinerPortrait.tsx` resolves
 * it.
 *
 * THE PRINCIPLE THIS EXISTS TO SERVE: one event, five possible readings. A no-hitter
 * should get a neutral on-the-ground recap, a hot take, a data autopsy and a
 * dismissal. If all five cards read the same, the feature has failed however many
 * templates were written -- so the personas are defined by what they REFUSE to write
 * at least as much as by what they cover.
 *
 * DETERMINISM. Nothing in this module may call `Math.random()`. `headlineEngine.ts`
 * has zero such calls today and a season's headline feed is part of the persistent
 * world; an unseeded pick here would make a reloaded save show a different newsroom
 * for the same games. `stableSeed` is the only source of variation and it is derived
 * from the event's identity.
 */

import type { Game } from '../types';

/** A reporter. Adding a sixth touches this file and its voice bank, nothing else. */
export type HeadlinerId = 'perez' | 'soo' | 'gatz' | 'scintilla' | 'tombuccelli';

/**
 * A semantic accent name, never a gradient string.
 *
 * These resolve to existing tokens in `src/index.css`; none of them requires a new
 * token. The point of the indirection is that `headlineEngine.ts` currently carries
 * 40 `from-[#…] via-[#…] to-[#…]` gradients that nothing consumes, and a card that
 * names its accent rather than inlining one cannot grow a new raw hex.
 */
export type AccentToken = 'neutral' | 'youth' | 'fire' | 'data' | 'sour' | 'house';

export const ACCENT_VAR: Readonly<Record<AccentToken, string>> = {
  neutral: 'var(--color-ink-dim)',
  youth: 'var(--color-info)',
  fire: 'var(--color-gold)',
  data: 'var(--color-platinum)',
  sour: 'var(--color-neg)',
  house: 'var(--color-ink-faint)',
};

/**
 * What can happen in a game that a reporter might care about.
 *
 * Grouped by the kind of story it makes rather than alphabetically, because the
 * grouping is what the affinity matrix below reads against.
 */
export type GameEventKind =
  // achievements
  | 'no_hitter' | 'perfect_game' | 'cycle' | 'multi_homer' | 'rbi_barrage'
  | 'on_base_machine' | 'hit_fury' | 'walk_off' | 'pitching_dome'
  | 'complete_game' | 'staff_wins'
  // game shape
  | 'extra_innings' | 'momentum_swing' | 'blowout' | 'shutout'
  | 'scrap_heap' | 'one_run_game'
  // narrative
  | 'underdog_win' | 'meltdown' | 'big_debut' | 'young_player'
  | 'losing_streak' | 'winning_streak'
  // analytic
  | 'anomaly' | 'sustained_rate' | 'expected_divergence';

/**
 * The substitutions available to a template.
 *
 * `AGE` is here because the youth writer's best line needs it
 * ('WAIT. {PLAYER} IS {AGE}???') and the input plan's slot list omitted it -- the
 * interpolation helper substitutes an empty string for an unknown key, so without
 * this the card renders as 'WAIT. X IS ???'. Every slot is optional: a persona must
 * never be handed a template whose slots it cannot fill, so a missing value collapses
 * the template to its `generic` bank instead.
 */
export interface HeadlineSlots {
  PLAYER?: string;
  AGE?: string;
  TEAM?: string;
  CITY?: string;
  RIVAL?: string;
  RIVAL_PITCHER?: string;
  ARENA?: string;
  OPPONENT?: string;
  LEAGUE?: string;
  FIGURE?: string;
}

export interface GameEvent {
  kind: GameEventKind;
  game: Game | null;
  slots: HeadlineSlots;
  playerId?: string;
  teamId?: string;
  /** 0-100. The shared currency for eligibility and priority. See `severityBand`. */
  severity: number;
  /** Negative events are the hater's primary fuel. */
  valence: 'positive' | 'negative' | 'neutral';
  /** Age of the player this event is about, when it is about one. */
  playerAge?: number;
}

/**
 * The facts a persona's gate may consult beyond the event itself.
 *
 * Deliberately narrow. Anything a gate needs should either be on the event or be one
 * of these three, because every extra input is another chance for a gate to depend on
 * something the rest of the pipeline does not.
 */
export interface HeadlinerContext {
  /** Win percentage of the away team entering the game. */
  awayWinPct: number;
  /** Win percentage of the home team entering the game. */
  homeWinPct: number;
  sameDivision: boolean;
  isPlayoffGame: boolean;
}

export interface HeadlinerProfile {
  id: HeadlinerId;
  displayName: string;
  /** Ticker use. */
  shortName: string;
  role: string;
  /** Asset basename under `src/assets/headliners/`, without extension. */
  portraitKey: string;
  accentToken: AccentToken;
  /** Event kinds this persona will consider. */
  covers: readonly GameEventKind[];
  /** Extra gate, applied after `covers`. */
  eligible?: (event: GameEvent, ctx: HeadlinerContext) => boolean;
  /** Multiplier on final priority. */
  priorityWeight: number;
}

/**
 * The marquee gate, shared rather than restated per persona.
 *
 * "Nationally televised" is both teams above .550, or a divisional rivalry, or a
 * playoff game. `getFeaturedGame` (headlineEngine.ts:1157) already scores exactly
 * this shape at .580; the threshold here is slightly looser because a reporter
 * covering a good game is not the same claim as the app picking a featured game.
 */
const marqueeGate = (ctx: HeadlinerContext): boolean =>
  (ctx.awayWinPct >= 0.55 && ctx.homeWinPct >= 0.55) || ctx.sameDivision || ctx.isPlayoffGame;

const SCINTILLA_MIN_SEVERITY = 55;
const SOO_MAX_AGE = 25;

export const HEADLINERS: readonly HeadlinerProfile[] = [
  {
    id: 'perez',
    displayName: 'HILDAGO PEREZ',
    shortName: 'PEREZ',
    role: 'FIELD REPORTER',
    portraitKey: 'hidalgoperez',
    accentToken: 'neutral',
    covers: [
      'walk_off', 'no_hitter', 'extra_innings', 'blowout',
      'underdog_win', 'scrap_heap', 'pitching_dome',
    ],
    eligible: (_event, ctx) => marqueeGate(ctx),
    priorityWeight: 1.0,
  },
  {
    id: 'soo',
    displayName: 'CHRISTINE SOO',
    shortName: 'SOO',
    role: 'YOUTH WRITER',
    portraitKey: 'christinesoo',
    accentToken: 'youth',
    covers: [
      'big_debut', 'young_player', 'multi_homer',
      'walk_off', 'on_base_machine', 'momentum_swing',
    ],
    // A HARD gate, not a preference. Given a story without a qualifying young player
    // she does not write it. A persona that breaks its own rule stops being a persona,
    // and the acceptance criterion is that she never writes about anyone over 25.
    eligible: (event) => typeof event.playerAge === 'number' && event.playerAge <= SOO_MAX_AGE,
    priorityWeight: 1.05,
  },
  {
    id: 'gatz',
    displayName: 'CHRIS GATZ',
    shortName: 'GATZ',
    role: 'FORMER PLAYER',
    portraitKey: 'chrisgatz',
    accentToken: 'fire',
    // The most permissive persona. He comments from inside the experience, so almost
    // anything with a result in it is fair game.
    covers: [
      'blowout', 'multi_homer', 'pitching_dome', 'complete_game',
      'staff_wins', 'walk_off', 'meltdown', 'shutout',
    ],
    priorityWeight: 1.0,
  },
  {
    id: 'scintilla',
    displayName: 'SCINTILLA',
    shortName: 'SCINTILLA',
    role: 'STATS ANALYST',
    portraitKey: 'scintilla',
    accentToken: 'data',
    covers: ['anomaly', 'sustained_rate', 'expected_divergence', 'meltdown', 'pitching_dome'],
    // He does not editorialise about a game that was merely uneventful. Severity is
    // the threshold that keeps him on the maths rather than the narrative.
    eligible: (event) => event.severity >= SCINTILLA_MIN_SEVERITY,
    priorityWeight: 1.1,
  },
  {
    id: 'tombuccelli',
    displayName: 'TOMBUCCELLI',
    shortName: 'TOMBUCCELLI',
    role: 'COLUMNIST',
    portraitKey: 'tombuccelli',
    accentToken: 'sour',
    covers: ['meltdown', 'shutout', 'losing_streak', 'anomaly', 'underdog_win'],
    // Negative only. Praise is routed through a separate rarity budget in
    // `headlinerPipeline`, not through this predicate, because the whole character is
    // the scarcity. He is meant to be silent during a good week.
    eligible: (event) => event.valence === 'negative',
    priorityWeight: 0.85,
  },
];

export const HEADLINER_BY_ID: Readonly<Record<HeadlinerId, HeadlinerProfile>> = Object.fromEntries(
  HEADLINERS.map((profile) => [profile.id, profile]),
) as Record<HeadlinerId, HeadlinerProfile>;

/** Positional arguments for `new RegExp`, not a template string. */
export const coversEvent = (profile: HeadlinerProfile, kind: GameEventKind): boolean =>
  profile.covers.includes(kind);

/**
 * The full gate: does this persona write about this event, in this game?
 *
 * `covers` first because it is the cheap set membership, then the persona's own
 * predicate. Both must pass.
 */
export const isEligible = (
  profile: HeadlinerProfile,
  event: GameEvent,
  ctx: HeadlinerContext,
): boolean => coversEvent(profile, event.kind) && (profile.eligible?.(event, ctx) ?? true);

/**
 * Severity bands, named so call sites read as an intent rather than a number.
 *
 * Existing game-story priorities in `headlineEngine.ts` run 140-180; severity x 2 +
 * 100 reproduces that range, so current tuning carries over.
 */
export const SEVERITY_BAND = {
  historic: 95,
  notable: 85,
  significant: 70,
  moderate: 55,
  minor: 40,
  negative: 25,
  routine: 10,
} as const;

/** Which band a severity falls in, for logs and for the analyser persona's floor. */
export const severityBand = (severity: number): keyof typeof SEVERITY_BAND => {
  if (severity >= SEVERITY_BAND.historic) return 'historic';
  if (severity >= SEVERITY_BAND.notable) return 'notable';
  if (severity >= SEVERITY_BAND.significant) return 'significant';
  if (severity >= SEVERITY_BAND.moderate) return 'moderate';
  if (severity >= SEVERITY_BAND.minor) return 'minor';
  if (severity >= SEVERITY_BAND.negative) return 'negative';
  return 'routine';
};

/**
 * A stable integer derived from a string. FNV-1a, matching the scheme
 * `playerDevelopment.ts` and `offseasonFreeAgency.ts` already use, so the repo reads
 * as one system rather than three hash conventions.
 */
export const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * Pick from a bank, deterministically.
 *
 * The seed must come from the event's identity, never a counter and never
 * `Math.random()`: a reloaded save has to show the same newsroom for the same games,
 * and Tombuccelli's rare praise must not flicker between reloads.
 */
export const pickSeeded = <T,>(items: readonly T[], seed: number): T | null =>
  items.length === 0 ? null : items[Math.abs(Math.floor(seed)) % items.length];

/** The seed for an event's voice selection. */
export const eventSeed = (event: GameEvent): number =>
  hashString(`${event.game?.gameId ?? event.kind}:${event.kind}:${event.playerId ?? ''}`);