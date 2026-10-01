/**
 * Stages 2 and 3: who covers what, and in whose voice.
 *
 * Stage 1 (`headlinerEvents.ts`) says what happened. This file decides which reporters
 * are eligible for it and renders each one's title and deck. It writes no thresholds
 * and parses no play logs -- both of those belong to Stage 1, and keeping them here
 * would be how the two started disagreeing.
 *
 * ONE EVENT, SEVERAL VOICES, CAPPED. A dramatic game can qualify every persona, and
 * five cards arguing about the same walk-off is exactly the failure the feature exists
 * to avoid -- the voices blur into one voice. So a single event contributes at most
 * `MAX_PERSONAS_PER_EVENT` candidates, and the primary slot prefers a marquee story
 * over a columnist's takedown, because a ticker that leads with the hater is tonally
 * wrong even when the hater is right.
 *
 * DETERMINISM IS THE LOAD-BEARING PROPERTY HERE. Template choice is seeded from the
 * event's identity, never from `Math.random()` and never from a counter: a reloaded
 * save has to show the same newsroom for the same games, or the world stops feeling
 * persistent. The same applies to the impression budget, or Tombuccelli's rare praise
 * flickers between reloads and the joke dies.
 */

import {
  eventSeed,
  isEligible,
  pickSeeded,
  severityBand,
  HEADLINERS,
  type AccentToken,
  type GameEvent,
  type GameEventKind,
  type HeadlineCandidate,
  type HeadlineSlots,
  type HeadlinerContext,
  type HeadlinerId,
  type HeadlinerProfile,
} from './headliners';
import { interpolate, pickTitle, pickDeck, VOICE_BANKS } from './headlinerVoices';

/**
 * How many personas may write about one event.
 *
 * Three, because that is the most that can be read as distinct positions on the same
 * play rather than as three versions of the same sentence.
 */
export const MAX_PERSONAS_PER_EVENT = 3;

/**
 * How many persona cards a day may hold.
 *
 * Six, chosen by the user. It is a display count and nothing downstream depends on it:
 * raising it does not change which stories are eligible or how they are ranked, only
 * how many are shown.
 */
export const MAX_PERSONA_CARDS = 6;

/** Slot bonuses for events that should own the lead. Mirrors `getFeaturedGame`. */
const SLOT_BONUS = {
  playoffGame: 25,
  walkOff: 20,
  sameDivision: 12,
  marquee: 10,
} as const;

/** Penalty on the primary slot for a columnist's negative-valence story. */
const PRIMARY_VALENCE_PENALTY = 15;

export interface HeadlinerPipelineInput {
  events: readonly GameEvent[];
  ctx: HeadlinerContext;
  /**
   * Impressions the columnist has already spent this season.
   *
   * Read as a parameter rather than from storage so the pipeline stays pure and the
   * caller owns persistence. `null` means the ledger has not been created yet, which
   * is every existing save, and reads as zero.
   */
  impressionsSpent?: number;
  /**
   * The month, 1-12, for the season-position impression budget.
   *
   * Passed rather than read from a clock so the budget is a function of the save's
   * state rather than of when the card was rendered -- a card that changed its mind
   * about whether the columnist is allowed a compliment because it was rendered in
   * August would be indefensible.
   */
  month?: number;
}

/**
 * The rarity budget for the columnist's praise.
 *
 * The whole character is the scarcity, so the rule is calendar-shaped rather than
 * probabilistic: nothing in the spring, at most one late in the summer, and a hard
 * cap of two a season. `TOMBUCCELLI_IMPRESSION_SEASON_CAP` is the ceiling and the
 * per-window table is when one may be spent.
 */
export const TOMBUCCELLI_IMPRESSION_SEASON_CAP = 2;

interface ImpressionWindow {
  /** Inclusive month bounds. */
  from: number;
  to: number;
  /** Minimum event severity before an impression is allowed in this window. */
  minSeverity: number;
}

const IMPRESSION_WINDOWS: readonly ImpressionWindow[] = [
  { from: 4, to: 7, minSeverity: 101 },
  { from: 8, to: 8, minSeverity: 90 },
  { from: 9, to: 9, minSeverity: 95 },
  { from: 10, to: 12, minSeverity: 100 },
];

/** Kinds the columnist is allowed to be impressed BY. Never a meltdown. */
const IMPRESSABLE_KINDS: readonly GameEventKind[] = [
  'no_hitter', 'perfect_game', 'cycle', 'multi_homer', 'hit_fury', 'pitching_dome',
];

/**
 * May the columnist spend an impression here?
 *
 * All three conditions must hold: the season cap, the calendar window's severity
 * floor, and an event kind worth being impressed by. Exported because the acceptance
 * criterion "impressions capped at 2 per season" needs to be assertable, not trusted.
 */
export const mayImpress = (
  event: GameEvent,
  options: { impressionsSpent: number; month?: number },
): boolean => {
  if (options.impressionsSpent >= TOMBUCCELLI_IMPRESSION_SEASON_CAP) return false;
  if (!IMPRESSABLE_KINDS.includes(event.kind)) return false;
  if (options.month === undefined) return false;
  const window = IMPRESSION_WINDOWS.find((entry) => options.month! >= entry.from && options.month! <= entry.to);
  // A window with an impossible floor is how "no praise in April" is expressed, which
  // is clearer than a separate early-season branch.
  if (!window) return false;
  return event.severity >= window.minSeverity;
};

/** Slot bonuses, which reward the events that should own the lead card. */
const slotBonusFor = (event: GameEvent, ctx: HeadlinerContext): number => {
  let bonus = 0;
  if (ctx.isPlayoffGame) bonus += SLOT_BONUS.playoffGame;
  if (event.kind === 'walk_off') bonus += SLOT_BONUS.walkOff;
  if (ctx.sameDivision) bonus += SLOT_BONUS.sameDivision;
  if (ctx.awayWinPct >= 0.58 && ctx.homeWinPct >= 0.58) bonus += SLOT_BONUS.marquee;
  return bonus;
};

export const priorityOf = (event: GameEvent, profile: HeadlinerProfile, ctx: HeadlinerContext): number =>
  event.severity * profile.priorityWeight + slotBonusFor(event, ctx);

/**
 * Stage 2 and 3 for a single event: every persona who will write about it.
 *
 * Deterministic end to end. The eligible set is sorted by priority and then by
 * reporter id, so two candidates with equal priority always order the same way, and
 * the cap takes the same three every time.
 */
export const candidatesForEvent = (
  event: GameEvent,
  ctx: HeadlinerContext,
  options: { impressionsSpent?: number; month?: number } = {},
): HeadlineCandidate[] => {
  const eligible = HEADLINERS.filter((profile) => {
    // The columnist's positive path is checked BEFORE `covers`, not after.
    //
    // It has to be. His `covers` deliberately lists only negative-valence kinds,
    // because that is what he normally writes about. Running `isEligible` first
    // would gate him out of `cycle`, `perfect_game` and every other kind he is
    // allowed to be impressed BY, and the rarity budget would be unreachable code --
    // a whole mechanism that reads as working and never fires, which is the same
    // failure shape as an inert feedback loop.
    if (profile.id === 'tombuccelli' && event.valence !== 'negative') {
      return mayImpress(event, {
        impressionsSpent: options.impressionsSpent ?? 0,
        month: options.month,
      });
    }
    return isEligible(profile, event, ctx);
  });

  const ranked = eligible
    .map((profile) => ({ profile, priority: priorityOf(event, profile, ctx) }))
    .sort((left, right) =>
      right.priority - left.priority || left.profile.id.localeCompare(right.profile.id),
    )
    .slice(0, MAX_PERSONAS_PER_EVENT);

  return ranked.map(({ profile, priority }) => {
    const seed = eventSeed(event) ^ seedForPersona(profile.id);
    const slots = slotsFor(event, profile);
    const bank = VOICE_BANKS[profile.id];
    const title = pickTitle(bank, event.kind, seed, slots);
    const deck = pickDeck(bank, event.kind, seed, slots);
    return {
      event,
      byline: profile.id,
      title,
      deck,
      priority,
      accentToken: profile.accentToken,
      game: event.game,
    };
  });
};

/**
 * Per-persona seed offset.
 *
 * Without it, every reporter covering the same event draws from the same index and
 * two personas whose banks happen to be the same length produce identical titles. A
 * stable per-reporter constant is enough to decorrelate them, and it stays
 * deterministic across reloads, which a counter would not.
 */
const PERSONA_SEED_OFFSET: Readonly<Record<HeadlinerId, number>> = {
  perez: 0x1f2e,
  soo: 0x3c4d,
  gatz: 0x5e6f,
  scintilla: 0x7a8b,
  tombuccelli: 0x9cad,
};

const seedForPersona = (id: HeadlinerId): number => PERSONA_SEED_OFFSET[id] ?? 0;

/**
 * The slots a reporter can actually fill.
 *
 * A reporter is only offered slots its events reliably carry. Handing the youth
 * writer a template needing `{RIVAL_PITCHER}` for a walk-off, where no opposing
 * pitcher is named, would interpolate an empty string and read as a bug.
 */
const slotsFor = (event: GameEvent, profile: HeadlinerProfile): HeadlineSlots => {
  const slots: HeadlineSlots = { ...event.slots };
  if (event.playerAge !== undefined && slots.AGE === undefined) {
    slots.AGE = String(event.playerAge);
  }
  // The columnist addresses players directly and the reporter addresses the game;
  // neither invents a slot the event did not carry.
  void profile;
  return slots;
};

/**
 * The day's persona cards.
 *
 * Selection, in order: rank every candidate by priority, walk the list, and accept
 * while no single event has already used up its allowance. Then apply the primary-slot
 * preference by demoting a heavily penalised negative-valence story out of first
 * place rather than dropping it, because the columnist's take is still worth printing.
 *
 * Returns fewer than `MAX_PERSONA_CARDS` on a thin day and that is correct: the
 * stalemate rule is the point. A quiet news day with two opinions is more convincing
 * than filler, and it is what makes a loud day land. Callers render an explicit empty
 * state rather than padding the list.
 */
export const buildPersonaDeck = (input: HeadlinerPipelineInput): HeadlineCandidate[] => {
  const options = { impressionsSpent: input.impressionsSpent ?? 0, month: input.month };

  const candidates = input.events
    .flatMap((event) => candidatesForEvent(event, input.ctx, options))
    .sort((left, right) => right.priority - left.priority || left.byline.localeCompare(right.byline));

  const perEvent = new Map<string, number>();
  const accepted: HeadlineCandidate[] = [];
  for (const candidate of candidates) {
    const eventKey = eventKeyFor(candidate);
    const used = perEvent.get(eventKey) ?? 0;
    if (used >= MAX_PERSONAS_PER_EVENT) continue;
    perEvent.set(eventKey, used + 1);
    accepted.push(candidate);
    if (accepted.length >= MAX_PERSONA_CARDS) break;
  }

  if (accepted.length < 2) return accepted;

  // Primary-slot preference. Only the first card moves, and only when a
  // non-negative-valence story is available to take its place -- otherwise a day with
  // one good column and one good game would be demoted to nothing.
  const [first, ...rest] = accepted;
  const penalised =
    first.event.valence === 'negative'
    ? first.priority - PRIMARY_VALENCE_PENALTY
    : first.priority;
  if (penalised >= rest[0].priority) return accepted;

  const swap = rest.findIndex((candidate) => candidate.event.valence !== 'negative');
  if (swap === -1) return accepted;
  const promoted = rest[swap];
  rest[swap] = first;
  return [promoted, ...rest];
};

/** Stable identity for an event across the candidate list. */
const eventKeyFor = (candidate: HeadlineCandidate): string =>
  `${candidate.event.game?.gameId ?? 'none'}:${candidate.event.kind}:${candidate.event.playerId ?? ''}`;

// ---------------------------------------------------------------------------
// Diagnostics, for a verifier rather than for the UI
// ---------------------------------------------------------------------------

export interface PersonaDeckDiagnostics {
  eventsIn: number;
  eventsEligibleForSomebody: number;
  candidatesBeforeCap: number;
  cardsPublished: number;
  /** Events nobody could cover -- a `covers` entry with no emitter, made visible. */
  orphanEvents: number;
  byline: Record<HeadlinerId, number>;
  /** Highest severity band seen, which says whether a quiet day is the engine's fault. */
  loudestBand: string;
}

/**
 * Why each event found nobody, for the same reason `coversEvent` is exported.
 *
 * A persona whose `covers` names a kind the detector never emits is silently dead, and
 * the aggregate "cards published" looks perfectly healthy while that persona has never
 * written. This is the number that catches it.
 */
export const diagnosePersonaDeck = (
  input: HeadlinerPipelineInput & { deck: readonly HeadlineCandidate[] },
): PersonaDeckDiagnostics => {
  const byline = Object.fromEntries(
    HEADLINERS.map((profile) => [profile.id, 0]),
  ) as Record<HeadlinerId, number>;

  let eligibleForSomebody = 0;
  let candidatesBeforeCap = 0;
  let orphanEvents = 0;

  for (const event of input.events) {
    const eligible = HEADLINERS.filter((profile) => isEligible(profile, event, input.ctx));
    if (eligible.length === 0) {
      orphanEvents += 1;
      continue;
    }
    eligibleForSomebody += 1;
    candidatesBeforeCap += eligible.length;
  }

  for (const card of input.deck) byline[card.byline] += 1;

  return {
    eventsIn: input.events.length,
    eventsEligibleForSomebody: eligibleForSomebody,
    candidatesBeforeCap,
    cardsPublished: input.deck.length,
    orphanEvents,
    byline,
    loudestBand: input.events.length > 0 ? severityBand(input.events[0].severity) : 'none',
  };
};

export { interpolate };