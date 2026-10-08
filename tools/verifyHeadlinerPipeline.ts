/**
 * Verifies the headliner pipeline: coverage, persona integrity, determinism.
 *
 * Every check here exists because a plausible-looking number can pass without any of
 * the machinery behind it working. That is not hypothetical -- it is how the inert
 * performance feedback passed every league-level health check while doing nothing, and
 * how a persona whose `covers` names a kind the detector never emits would look
 * perfectly healthy in every aggregate.
 *
 * Run: npx tsx tools/verifyHeadlinerPipeline.ts
 */

import { readFileSync } from 'node:fs';
import {
  ACCENT_VAR,
  HEADLINERS,
  HEADLINER_BY_ID,
  eventSeed,
  hashString,
  isEligible,
  pickSeeded,
  type GameEventKind,
  type GameEvent,
} from '../src/logic/headliners';
import { EMITTABLE_KINDS } from '../src/logic/headlinerEvents';
import {
  MAX_PERSONA_CARDS,
  MAX_PERSONAS_PER_EVENT,
  TOMBUCCELLI_IMPRESSION_SEASON_CAP,
  buildPersonaDeck,
  candidatesForEvent,
  diagnosePersonaDeck,
  mayImpress,
  type HeadlinerPipelineInput,
} from '../src/logic/headlinerPipeline';
import { VOICE_BANKS, VOICE_BANK_COUNTS, interpolate, pickTitle } from '../src/logic/headlinerVoices';

interface Check {
  label: string;
  pass: boolean;
  measured: string;
}

const results: Check[] = [];
const failures: string[] = [];

const check = (label: string, pass: boolean, measured: string, why?: string): void => {
  results.push({ label, pass, measured: pass ? measured : (why ?? `FAILED, observed: ${measured}`) });
  if (!pass) failures.push(`${label}: ${why ?? measured}`);
};

const ctx = { awayWinPct: 0.62, homeWinPct: 0.58, sameDivision: true, isPlayoffGame: false };

const event = (over: Partial<GameEvent> & { kind: GameEventKind }): GameEvent => ({
  game: null,
  slots: {},
  severity: 80,
  valence: 'neutral',
  ...over,
});

// --- 1. every declared kind is emittable, and every emittable kind is covered ---

/*
 * The third hand-maintained copy of this list.
 *
 * `checkHeadlinerCoverage.ts` and this file both transcribe the `GameEventKind` union rather than
 * deriving it, because TypeScript will not enumerate a union into a value. Adding the postseason
 * kinds meant editing both, and this one caught the omission rather than letting it through -- which
 * is the argument for a redundant check. If a fourth copy ever appears, the right answer is to
 * export one list from `headliners.ts` and import it in both, not to add a third transcription.
 */
const DECLARED_KINDS: readonly GameEventKind[] = [
  'no_hitter', 'perfect_game', 'cycle', 'multi_homer', 'rbi_barrage',
  'on_base_machine', 'hit_fury', 'walk_off', 'pitching_dome',
  'complete_game', 'staff_wins', 'extra_innings', 'momentum_swing', 'blowout',
  'shutout', 'scrap_heap', 'one_run_game', 'underdog_win', 'meltdown',
  'big_debut', 'young_player', 'losing_streak', 'winning_streak', 'anomaly',
  'sustained_rate', 'expected_divergence',
  'series_clinched', 'eliminated', 'championship',
];

const missingEmitters = DECLARED_KINDS.filter((kind) => !EMITTABLE_KINDS.includes(kind));
const undeclaredEmitters = EMITTABLE_KINDS.filter((kind) => !DECLARED_KINDS.includes(kind));

check(
  'every declared event kind has a detector',
  missingEmitters.length === 0,
  `${DECLARED_KINDS.length} declared, ${EMITTABLE_KINDS.length} emittable`,
  `these declared kinds have no detector: ${missingEmitters.join(', ')}. A kind with no ` +
    `emitter leaves every persona that lists it silently ineligible forever, and every ` +
    `aggregate still looks healthy`,
);
check(
  'every detector emits a declared kind',
  undeclaredEmitters.length === 0,
  'no undeclared kinds emitted',
  `these emitted kinds are not in the union: ${undeclaredEmitters.join(', ')}`,
);

/** The one that would actually hurt: a persona covering a kind nothing emits. */
const coveredButUnemittable = HEADLINERS.flatMap((profile) =>
  profile.covers.filter((kind) => !EMITTABLE_KINDS.includes(kind)).map((kind) => `${profile.id}:${kind}`),
);
check(
  'no persona covers a kind nothing emits',
  coveredButUnemittable.length === 0,
  `${HEADLINERS.length} personas, ${coveredButUnemittable.length} dead coverage entries`,
  `these persona coverage entries can never fire: ${coveredButUnemittable.join(', ')}`,
);

// --- 2. persona integrity -----------------------------------------------------

// NOTE the naming below. An earlier version of this file named these variables
// `sooViolations` / `perezBlocked` while holding the result of `isEligible`, which is
// the OPPOSITE of what the name says -- so three checks failed against gates that
// were working correctly. `accepts` below means what it says.
const sooAboveGate = [26, 31, 40].filter((age) =>
  isEligible(HEADLINER_BY_ID.soo, event({ kind: 'young_player', playerAge: age }), ctx));
check(
  'Soo refuses every player above 25',
  sooAboveGate.length === 0,
  'refused ages 26, 31 and 40',
  `Soo accepted ages ${sooAboveGate.join(', ')}, which are above her hard gate of 25`,
);
const sooInGate = [21, 24, 25].filter((age) =>
  isEligible(HEADLINER_BY_ID.soo, event({ kind: 'young_player', playerAge: age }), ctx));
check(
  'Soo accepts players inside her gate',
  sooInGate.length === 3,
  `accepted ${sooInGate.length} of 3 in-gate ages (21, 24, 25)`,
  `Soo accepted only ${sooInGate.join(', ')} of the in-gate ages 21, 24 and 25, so her gate is too tight and she would rarely write`,
);

const tombuccelliPositives = [
  event({ kind: 'no_hitter', valence: 'positive', severity: 99 }),
  event({ kind: 'cycle', valence: 'positive', severity: 97 }),
].filter((e) => isEligible(HEADLINER_BY_ID.tombuccelli, e, ctx));
check(
  'Tombuccelli is ineligible for positive events by default',
  tombuccelliPositives.length === 0,
  'a no-hitter and a cycle are both refused without an impression budget',
  'Tombuccelli accepted a positive event with no budget spent, so his negative-only rule is not holding',
);

const impressionNoBudget = mayImpress(event({ kind: 'no_hitter', severity: 99 }), { impressionsSpent: 0 });
const impressionSpent = mayImpress(event({ kind: 'no_hitter', severity: 99 }), {
  impressionsSpent: TOMBUCCELLI_IMPRESSION_SEASON_CAP,
});
check(
  'Tombuccelli impressions are capped and gated',
  !impressionSpent && !impressionNoBudget,
  `refused once ${TOMBUCCELLI_IMPRESSION_SEASON_CAP} spent; refused without a month`,
  'the impression budget did not refuse a spent or month-less case, so the cap is not holding',
);
const augustImpression = mayImpress(event({ kind: 'no_hitter', severity: 92 }), {
  impressionsSpent: 0,
  month: 8,
});
check(
  'the August impression window opens at severity 90',
  augustImpression,
  `severity 92 in August accepted: ${augustImpression}`,
  'a severity-92 event in August was refused, so the calendar window is not behaving as documented',
);

const perezRefusesQuiet = isEligible(HEADLINER_BY_ID.perez, event({ kind: 'no_hitter' }), {
  awayWinPct: 0.3,
  homeWinPct: 0.31,
  sameDivision: false,
  isPlayoffGame: false,
});
const perezAcceptsMarquee = isEligible(HEADLINER_BY_ID.perez, event({ kind: 'no_hitter' }), ctx);
check(
  'Perez refuses a game outside his marquee gate',
  !perezRefusesQuiet,
  `refused at .300/.310 with no rivalry and no playoffs (accepted: ${perezRefusesQuiet})`,
  'Perez accepted a game his marquee gate should have refused',
);
check(
  'Perez accepts a game inside his marquee gate',
  perezAcceptsMarquee,
  `accepted on a divisional marquee game (accepted: ${perezAcceptsMarquee})`,
  'Perez refused a game his marquee gate should have admitted, so he would rarely write',
);

/*
 * THE SEVERITY FLOOR, NOW TESTED ON HOANI.
 *
 * These two checks used to run against Scintilla. He is a forecaster and no longer files sideline
 * reports, and his entry is gone, so the pair has moved to Hoani -- who holds the same floor of 55
 * because it was carried across from him wholesale. Retargeting rather than deleting is the point:
 * the floor is still a live number deciding what Hoani files on, and losing the assertions because
 * the persona who set it left the desk is how a threshold quietly drifts.
 *
 * `tools/checkHeadlinerCoverage.ts` records where the 55 came from; this file only has to prove the
 * behaviour, which is the half that actually decides what appears on screen.
 */
const hoaniRefusesBelow = isEligible(
  HEADLINER_BY_ID.hoani,
  event({ kind: 'anomaly', severity: 54 }),
  ctx,
);
check(
  'Hoani refuses below severity 55',
  !hoaniRefusesBelow,
  `refused at severity 54 (accepted: ${hoaniRefusesBelow})`,
  'Hoani accepted an event below his severity floor',
);
const hoaniAcceptsAt = isEligible(
  HEADLINER_BY_ID.hoani,
  event({ kind: 'anomaly', severity: 55 }),
  ctx,
);
check(
  'Hoani accepts at severity 55',
  hoaniAcceptsAt,
  `accepted at severity 55 (accepted: ${hoaniAcceptsAt})`,
  'Hoani refused an event exactly at his floor, so the threshold is off by one',
);

// --- 3. determinism -----------------------------------------------------------

const sampleEvent = event({
  kind: 'walk_off',
  severity: 88,
  valence: 'positive',
  playerAge: 23,
  slots: { PLAYER: 'Test Hitter', TEAM: 'Test City Sentries', CITY: 'Testville', ARENA: 'Testville', OPPONENT: 'Test Away', AGE: '23', FIGURE: '4' },
});
const firstRun = candidatesForEvent(sampleEvent, ctx, { impressionsSpent: 0, month: 8 });
const secondRun = candidatesForEvent(sampleEvent, ctx, { impressionsSpent: 0, month: 8 });
check(
  'the pipeline is deterministic across calls',
  JSON.stringify(firstRun) === JSON.stringify(secondRun),
  `${firstRun.length} candidates, identical JSON across two calls`,
  'two calls on the same event returned different candidates, so a reloaded save would show a different newsroom',
);

// A different event must NOT produce the same title, or seeded selection is not working.
const otherEvent = { ...sampleEvent, kind: 'cycle' as GameEventKind };
const otherTitle = pickTitle(VOICE_BANKS.perez, 'cycle', eventSeed(otherEvent), sampleEvent.slots);
const sameTitle = pickTitle(VOICE_BANKS.perez, 'walk_off', eventSeed(sampleEvent), sampleEvent.slots);
check(
  'seeded selection actually varies with the event',
  otherTitle !== sameTitle || firstRun.length === 0,
  `different kinds produced "${otherTitle}" vs "${sameTitle}"`,
  'two different events produced an identical title, so the seed is not reaching the pick',
);

const mathRandom = ['headliners', 'headlinerEvents', 'headlinerPipeline', 'headlinerVoices']
  .map((name) => {
    const file = `src/logic/${name}.ts`;
    // Read the file as text so this counts CALLS, not the comments that warn about it.
    const text = readFileSync(file, 'utf8');
    const withoutComments = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    return { name, count: (withoutComments.match(/Math\.random\s*\(/g) ?? []).length };
  });
const randomCalls = mathRandom.filter((entry) => entry.count > 0);
check(
  'no Math.random call in any headliner logic file',
  randomCalls.length === 0,
  mathRandom.map((entry) => `${entry.name} ${entry.count}`).join(', '),
  `these files call Math.random: ${randomCalls.map((e) => e.name).join(', ')}. A headline feed ` +
    `that varies on reload stops feeling like a persistent world`,
);

// The rarity budget is only meaningful if it can actually fire. The columnist's
// `covers` lists only negative kinds by design, so an impression on `cycle` has to
// bypass `covers` entirely. It did not: the gate ran first and filtered him out
// before the budget was consulted, which made the whole mechanism unreachable code.
const impressionReachable = candidatesForEvent(
  event({
    kind: 'cycle',
    severity: 97,
    valence: 'positive',
    playerAge: 27,
    slots: { PLAYER: 'Cycle Hitter', TEAM: 'Cycle Club', CITY: 'Cycletown', OPPONENT: 'Cycle Rivals', AGE: '27', FIGURE: '4' },
  }),
  ctx,
  { impressionsSpent: 0, month: 9 },
).some((candidate) => candidate.byline === 'tombuccelli');
check(
  'the impression budget can actually be spent',
  impressionReachable,
  `a severity-97 cycle in September with 0 spent produced an impression: ${impressionReachable}`,
  'no impression was produced for an event the budget should have allowed. The ' +
    'positive path is being gated by `covers` before the budget is consulted, which ' +
    'makes the whole rarity mechanism unreachable code that reads as working',
);

// --- 4. templates never render half-filled -------------------------------------

const templatesChecked: string[] = [];
const unfillable: string[] = [];
Object.values(VOICE_BANKS).forEach((bank) => {
  Object.values(bank.titles).forEach((list) => list.forEach((t) => templatesChecked.push(t)));
});
// Every template, given NO slots, must be refused rather than rendered.
const sparseSlots = { PLAYER: 'P' };
Object.values(VOICE_BANKS).forEach((bank) => {
  Object.values(bank.titles).forEach((list) =>
    list.forEach((t) => {
      const filled = interpolate(t, sparseSlots);
      // Either it filled (every slot it needs was in `sparseSlots`) or it was refused.
      // It must never be a string still containing a brace.
      if (filled !== null && filled.includes('{')) unfillable.push(t);
    }),
  );
});
check(
  'a filled template never leaks a brace',
  unfillable.length === 0,
  `${templatesChecked.length} title templates checked, ${unfillable.length} leaked`,
  `these rendered with an unresolved slot: ${unfillable.slice(0, 3).join(' | ')}`,
);

const sooAgeTemplate = "{PLAYER} Is {AGE} and Doing This";
const refusedWithoutAge = interpolate(sooAgeTemplate, { PLAYER: 'Someone' }) === null;
check(
  'a template needing a missing slot is refused, not half-printed',
  refusedWithoutAge,
  'the youth writer template returns null without AGE rather than printing "Someone Is  and Doing This"',
  'a template rendered with a slot it did not have, which is the "WAIT. X IS ???" bug',
);

// --- 5. deck shape and the stalemate rule ------------------------------------

const deckInput: HeadlinerPipelineInput = { events: [], contextFor: () => ctx };
const emptyDeck = buildPersonaDeck(deckInput);
check(
  'an empty news day ships zero cards rather than filler',
  emptyDeck.length === 0,
  `0 cards from 0 events`,
  `an empty day produced ${emptyDeck.length} cards, so filler is still running`,
);

/**
 * Valence that agrees with the kind.
 *
 * An earlier version of this fixture set valence from a two-item list and gave every
 * other kind 'positive' -- which handed `losing_streak` a positive valence and made
 * it look like an orphan, because the columnist's negative-only gate correctly
 * refused it. The detector always assigns a losing streak negative valence; the
 * fixture has to agree with the detector or the orphan count measures the fixture.
 */
const NEGATIVE_KINDS: readonly GameEventKind[] = ['meltdown', 'shutout', 'losing_streak'];

const manyEvents = EMITTABLE_KINDS.map((kind, index) =>
  event({
    kind,
    severity: 90 - index,
    valence: NEGATIVE_KINDS.includes(kind) ? 'negative' : 'positive',
    playerAge: 23,
    slots: {
      PLAYER: `P${index}`, TEAM: `T${index}`, CITY: `C${index}`, ARENA: `A${index}`,
      OPPONENT: `O${index}`, AGE: '23', FIGURE: String(index),
    },
  }),
);
const fullDeck = buildPersonaDeck({ events: manyEvents, contextFor: () => ctx, impressionsSpent: 0, month: 8 });
check(
  'a loud day publishes at most the card cap',
  fullDeck.length <= MAX_PERSONA_CARDS,
  `${fullDeck.length} cards from ${manyEvents.length} events, cap ${MAX_PERSONA_CARDS}`,
  `published ${fullDeck.length} cards, above the ${MAX_PERSONA_CARDS} cap`,
);

const perEventCounts = new Map<string, number>();
fullDeck.forEach((card) => {
  const key = `${card.event.kind}:${card.event.playerId ?? ''}`;
  perEventCounts.set(key, (perEventCounts.get(key) ?? 0) + 1);
});
const maxPerEvent = Math.max(0, ...perEventCounts.values());
check(
  'no event is covered by more than the per-event allowance',
  maxPerEvent <= MAX_PERSONAS_PER_EVENT,
  `busiest event has ${maxPerEvent} of ${MAX_PERSONAS_PER_EVENT}`,
  `one event produced ${maxPerEvent} cards, so the voices are blurring together`,
);

// The negative-valence story must not lead.
const negativeLead = fullDeck[0]?.event.valence === 'negative';
const hasPositiveAlternative = fullDeck.some((card) => card.event.valence !== 'negative');
check(
  'a columnist takedown does not take the lead slot',
  !negativeLead || !hasPositiveAlternative,
  `lead valence "${fullDeck[0]?.event.valence}" with a non-negative alternative present: ${hasPositiveAlternative}`,
  'a negative-valence story led the deck while a non-negative one was available',
);

// --- 6. diagnostics are non-vacuous ------------------------------------------

/*
 * The rotation itself. Built on the loud-day fixture, a pure priority sort gave one
 * reporter most of the deck and the youth writer none, because a walk-off at severity
 * 89 outranks a young player's game at 46. Asserting the shape here rather than
 * trusting the playtest is what stops that regressing.
 */
const distinctBylines = new Set(fullDeck.map((card) => card.byline)).size;
const topBylinesShare =
  fullDeck.length === 0
    ? 0
    : Math.max(...HEADLINERS.map((p) => fullDeck.filter((c) => c.byline === p.id).length)) /
      fullDeck.length;
check(
  'the deck is a rotation, not one reporter filling it',
  distinctBylines >= 4 && topBylinesShare <= 0.5,
  `${distinctBylines} distinct bylines across ${fullDeck.length} cards, largest share ${(topBylinesShare * 100).toFixed(0)}%`,
  `the deck used only ${distinctBylines} distinct bylines and one reporter took ` +
    `${(topBylinesShare * 100).toFixed(0)}% of it. A newsroom that publishes one voice is not five reporters`,
);

const diagnostics = diagnosePersonaDeck({ events: manyEvents, contextFor: () => ctx, deck: fullDeck });
const publishedTotal = Object.values(diagnostics.byline).reduce((s, n) => s + n, 0);
check(
  'diagnostics account for every published card',
  publishedTotal === fullDeck.length,
  `byline counts total ${publishedTotal} against ${fullDeck.length} cards`,
  `diagnostics total ${publishedTotal} but ${fullDeck.length} cards were published`,
);
// Only genuinely UNCOVERABLE events are a defect. The separate gateRefusals figure
// is expected to be non-zero -- the marquee gate and the age gate refusing a quiet
// day's one-run games is them working, and asserting it is zero would have forced the
// gates open to satisfy a test.
check(
  'no emitted event is uncoverable',
  diagnostics.unemittableKinds.length === 0,
  `${diagnostics.unemittableKinds.length} uncoverable kinds, ${diagnostics.gateRefusals} gate refusals ` +
    `out of ${diagnostics.eventsIn} events`,
  `these kinds are emitted but no persona lists them, so they are detected and never ` +
    `written about: ${diagnostics.unemittableKinds.join(', ')}`,
);

// --- 7. the shipped constants -----------------------------------------------

check(
  'every accent token resolves to a CSS variable',
  Object.values(ACCENT_VAR).every((value) => value.startsWith('var(--color-')),
  `${Object.keys(ACCENT_VAR).length} tokens, all var(--color-*)`,
  'an accent token does not resolve to a colour variable',
);

const templateTotals = VOICE_BANK_COUNTS;
console.log('\nVOICE BANK SIZE');
console.log(`  ${templateTotals.titles} titles, ${templateTotals.decks} decks`);
console.log(`  input plan target was ~196 titles and ~132 decks`);
console.log(`  coverage: ${(templateTotals.titles / 196 * 100).toFixed(0)}% of target titles`);
console.log('  Deliberate: the criterion that matters is that consecutive days read differently,');
console.log('  and only a played season can judge that.');

console.log('\nPERSONA COVERAGE');
HEADLINERS.forEach((profile) => {
  const deckCount = fullDeck.filter((card) => card.byline === profile.id).length;
  console.log(
    `  ${profile.displayName.padEnd(18)} covers ${String(profile.covers.length).padStart(2)} kinds, ` +
      `${deckCount} card${deckCount === 1 ? '' : 's'} on the loud-day fixture`,
  );
});

console.log('\nCHECKS');
results.forEach((entry, index) => {
  console.log(`  ${entry.pass ? 'PASS' : 'FAIL'}  ${String(index + 1).padStart(2)}. ${entry.label}`);
  console.log(`          ${entry.measured}`);
});

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks PASS`);
if (failures.length > 0) {
  console.log('\nFAILURES');
  failures.forEach((line) => console.log(`  - ${line}`));
  process.exitCode = 1;
}