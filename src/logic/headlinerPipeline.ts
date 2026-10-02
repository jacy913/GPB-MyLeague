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
  coversEvent,
  eventSeed,
  isEligible,
  severityBand,
  HEADLINERS,
  type GameEvent,
  type GameEventKind,
  type HeadlineCandidate,
  type HeadlineSlots,
  type HeadlinerContext,
  type HeadlinerId,
  type HeadlinerProfile,
} from './headliners';
import { interpolate, pickDeck, pickTitleWithTemplate, VOICE_BANKS } from './headlinerVoices';
import type { Game } from '../types';

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
  /**
   * The context for an event's own game.
   *
   * A FUNCTION, not a single value, and that distinction is load-bearing. Every
   * persona gate reads game-shaped facts -- the reporter's marquee test needs both
   * clubs' records at the time of THIS game -- and a deck spans many games. Handing
   * the whole deck one context would make the marquee gate either always true or
   * always false, which is the same as not having it.
   */
  contextFor: (game: Game | null) => HeadlinerContext;
  /**
   * Impressions the columnist has already spent this season.
   *
   * Read as a parameter rather than from storage so the pipeline stays pure and the
   * caller owns persistence. Absent means the ledger has not been created yet, which
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
  /**
   * Titles already shown, most recent first, per byline.
   *
   * THE MEMORY THAT MAKES CONSECUTIVE DAYS READ DIFFERENTLY. It exists because a
   * three-season playtest measured the same title on ~90 of 179 consecutive day pairs,
   * and the two obvious explanations were both wrong: the seeds are uniform and every
   * bank is fully used. The cause is arithmetic -- `staff_wins` alone publishes about
   * 2,446 cards a season from eight templates, so adjacent days MUST collide
   * sometimes, and no quantity of extra prose changes that.
   *
   * The caller owns it because only the caller knows what "recently" means: the panel
   * has the last few days of the dashboard in hand, while the playtest has a whole
   * season. An empty map is legal and degrades to the old seeded-only behaviour.
   *
   * Truncation is the caller's business too, but it should be generous: the value is
   * in remembering more than just yesterday, because after a bank has cycled once the
   * previous title comes back round and avoiding only the last one still repeats every
   * eighth day.
   */
  recentTemplatesByByline?: ReadonlyMap<HeadlinerId, readonly string[]>;
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
/**
 * Kinds the columnist may spend an impression on.
 *
 * EXPORTED, and deliberately not part of his `covers` list in headliners.ts.
 *
 * The two are different sets and both are real. `covers` is the ordinary gate. This list
 * is checked instead, by `mayImpress`, because his positive-valence path is evaluated
 * BEFORE `isEligible` -- otherwise the rarity budget would be unreachable code.
 *
 * Exported for the same reason `EMITTABLE_KINDS` is: a verifier has to be able to assert
 * that a voice bank holding titles for these kinds is reachable rather than stranded, and
 * a check that cannot read the constant cannot do that. Without this, `measureVoiceBanks`
 * reported five of his best titles as dead content, because `covers` does not contain
 * them.
 */
export const IMPRESSABLE_KINDS: readonly GameEventKind[] = [
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
  options: {
    impressionsSpent?: number;
    month?: number;
    /**
     * Templates each reporter has already used recently, keyed by byline.
     *
     * Keyed rather than shared because the memory is per VOICE: the columnist avoiding
     * his own last headline is a different fact from the analyst avoiding it, and one
     * reporter exhausting his bank must not start suppressing another reporter's best
     * available line. `pickTitle` treats an exhausted bank as a legal repeat, so the
     * worst case is a repeat rather than a missing card.
     */
    recentTemplatesByByline?: ReadonlyMap<HeadlinerId, readonly string[]>;
  } = {},
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
    const recent = options.recentTemplatesByByline?.get(profile.id) ?? [];
    const picked = pickTitleWithTemplate(bank, event.kind, seed, slots, recent);
    const title = picked.text;
    const deck = pickDeck(bank, event.kind, seed, slots, recent);
    return {
      event,
      byline: profile.id,
      title,
      titleTemplate: picked.template,
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
  hoani: 0x8b9c,
  shinonome: 0xa1b2,
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
 * One column per reporter first, then a second pass for the loudest remaining story.
 * See the note on the fill loop below for why it is a rotation rather than a ranking.
 *
 * The primary-slot preference is applied last, demoting a heavily penalised
 * negative-valence story out of first place rather than dropping it -- the columnist's
 * take is still worth printing, just not as the lead.
 *
 * Returns fewer than `MAX_PERSONA_CARDS` on a thin day and that is correct: the
 * stalemate rule is the point. A quiet news day with two opinions is more convincing
 * than filler, and it is what makes a loud day land. Callers render an explicit empty
 * state rather than padding the list.
 */
export const buildPersonaDeck = (input: HeadlinerPipelineInput): HeadlineCandidate[] => {
  const options = {
    impressionsSpent: input.impressionsSpent ?? 0,
    month: input.month,
    recentTemplatesByByline: input.recentTemplatesByByline,
  };

  const candidates = input.events
    .flatMap((event) => candidatesForEvent(event, input.contextFor(event.game), options))
    .sort((left, right) => right.priority - left.priority || left.byline.localeCompare(right.byline));

  const perEvent = new Map<string, number>();
  const bylineCount = new Map<HeadlinerId, number>();
  const accepted: HeadlineCandidate[] = [];
  /*
   * FILL BY ROTATION, NOT BY RANK.
   *
   * Pass 1 takes each reporter's single best story, in priority order, skipping
   * anyone already in the deck. That guarantees the five voices appear whenever the
   * day affords five opinions, instead of whichever one voice happened to cover the
   * day's loudest event.
   *
   * MEASURED, NOT ASSUMED. A pure priority sort over three real seasons gave one
   * reporter 1,865 cards, another 3, and the youth writer 0 across 540 days. The
   * cause is arithmetic rather than chance: a walk-off scores 89 and a one-run game
   * 55, so on any day with a walk-off the four reporters who cover it fill all six
   * slots before a 55 is ever reached, and a reporter covering only low-severity
   * kinds never appears at all. The youth writer was not gated out -- 2,612 events
   * qualified for her -- she simply never won a slot.
   *
   * Pass 2 then fills any remaining slots by priority, second column from whoever is
   * left, so a day with more news than voices still uses the whole carousel.
   *
   * Variety is therefore a STRUCTURAL property of the deck rather than a thing that
   * happens to occur when the schedule is kind.
   */
  const take = (candidate: HeadlineCandidate): void => {
    const eventKey = eventKeyFor(candidate);
    const perEventUsed = perEvent.get(eventKey) ?? 0;
    if (perEventUsed >= MAX_PERSONAS_PER_EVENT) return;
    perEvent.set(eventKey, perEventUsed + 1);
    bylineCount.set(candidate.byline, (bylineCount.get(candidate.byline) ?? 0) + 1);
    accepted.push(candidate);
  };

  for (const candidate of candidates) {
    if (accepted.length >= MAX_PERSONA_CARDS) break;
    if ((bylineCount.get(candidate.byline) ?? 0) > 0) continue;
    take(candidate);
  }
  if (accepted.length < MAX_PERSONA_CARDS) {
    for (const candidate of candidates) {
      if (accepted.length >= MAX_PERSONA_CARDS) break;
      if (accepted.includes(candidate)) continue;
      take(candidate);
    }
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
  /**
   * Events no persona can EVER cover: a kind listed in nobody's `covers`.
   *
   * THE FIGURE THAT MATTERS. It is zero by construction once every emitted kind has
   * a covering persona, and it is the one number that catches the failure mode this
   * whole architecture is built to avoid -- a detector running on every game whose
   * results are never written about, while every visible aggregate stays healthy.
   */
  unemittableKinds: readonly GameEventKind[];
  /**
   * Events a persona could cover in principle but whose GATES refused today.
   *
   * Deliberately separated from `unemittableKinds` because the two mean opposite
   * things. A high count here is the gates working: the reporter only writes marquee
   * games, the youth writer only writes about the young, and a 435-count pile of
   * one-run games nobody took is the quiet midseason, not a defect. Reporting both as
   * one "orphan" number would have made a working gate look like a broken registry,
   * and would have hidden a genuine dead coverage entry inside the noise.
   */
  gateRefusals: number;
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
  let gateRefusals = 0;
  // Keyed by kind rather than counted, because the KIND is the finding: 435 one-run
  // games is a quiet stretch of the season, whereas a single `hit_fury` here would be
  // a dead coverage entry that no amount of reading would reveal.
  const unemittable = new Set<GameEventKind>();

  for (const event of input.events) {
    const covered = HEADLINERS.filter((profile) => coversEvent(profile, event.kind));
    if (covered.length === 0) {
      // Nobody even lists this kind. A bug, and a permanent one.
      unemittable.add(event.kind);
      continue;
    }
    const eligible = covered.filter((profile) =>
      isEligible(profile, event, input.contextFor(event.game)),
    );
    if (eligible.length === 0) {
      // Listed but refused: the gates did their job today.
      gateRefusals += 1;
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
    unemittableKinds: Array.from(unemittable).sort(),
    gateRefusals,
    byline,
    loudestBand: input.events.length > 0 ? severityBand(input.events[0].severity) : 'none',
  };
};

export { interpolate };