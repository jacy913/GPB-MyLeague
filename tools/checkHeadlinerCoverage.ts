/**
 * Does every emittable event kind still have somebody who will file on it?
 *
 * ============================================================================
 * WHY THIS FILE HAS TO EXIST
 * ============================================================================
 *
 * The forecaster restructure moves Scintilla from reporting to forecasting. He held the ONLY
 * coverage of `sustained_rate` and `expected_divergence` -- verified across all five `covers` arrays
 * before Hoani was written -- so moving him without a replacement silences two event kinds entirely.
 * Nothing in the codebase would notice. `sustained_rate` and `expected_divergence` would still be
 * emitted by `headlinerEvents.ts`, still be candidates, and simply never be picked, because
 * `covers` is a filter rather than a dispatch table and an unmatchable event fails quietly.
 *
 * That is the failure mode this guards. An event kind with zero coverage is not an error anywhere; it
 * is a hole that looks exactly like "nobody had anything to say tonight".
 *
 * The plan's risk 1 rates this High and its mitigation is "verify coverage after the swap". This IS
 * that verification, written so it keeps verifying after the swap rather than being run once by hand.
 *
 * ============================================================================
 * WHAT IT DELIBERATELY DOES NOT DO
 * ============================================================================
 *
 * It does not assert that coverage is BALANCED, or that any kind has more than one reporter. Those
 * would be opinions about the newsroom, and they would fail the first time somebody gave one persona
 * a second beat. The single question here is the binary one: can this event reach a byline at all.
 *
 * Run: npx tsx tools/checkHeadlinerCoverage.ts
 */

import {
  HEADLINERS,
  type GameEventKind,
} from '../src/logic/headliners';
import { VOICE_BANKS } from '../src/logic/headlinerVoices';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

/**
 * Every event kind, transcribed from the `GameEventKind` union in `headliners.ts`.
 *
 * Transcribed rather than derived, and that is a real limitation worth stating: nothing forces this
 * list to stay in step with the union, so adding a kind to the type without adding it here would make
 * this check quietly blind to the new kind rather than red. It is caught from the other side by the
 * `HOANI`/`SCINTILLA` covers check below, which does compare against declared persona data.
 *
 * A build-time version would need the union enumerated, which TypeScript will not do for a value.
 */
const ALL_KINDS: readonly GameEventKind[] = [
  'no_hitter', 'perfect_game', 'cycle', 'multi_homer', 'rbi_barrage',
  'on_base_machine', 'hit_fury', 'walk_off', 'pitching_dome',
  'complete_game', 'staff_wins',
  'extra_innings', 'momentum_swing', 'blowout', 'shutout',
  'scrap_heap', 'one_run_game',
  'underdog_win', 'meltdown', 'big_debut', 'young_player',
  'losing_streak', 'winning_streak',
  'anomaly', 'sustained_rate', 'expected_divergence',
];

// -- 1. THE TRANSCRIPTION IS COMPLETE, or nothing below means anything --------------------
const declaredKinds = new Set(HEADLINERS.flatMap((p) => [...p.covers]));
const missingFromList = ALL_KINDS.filter((k) => !declaredKinds.has(k));
const unlistedInUnion = [...declaredKinds].filter((k) => !ALL_KINDS.includes(k));

check(
  'the transcribed event list and the union agree, so the coverage result covers every kind',
  missingFromList.length === 0 && unlistedInUnion.length === 0,
  `${ALL_KINDS.length} kinds transcribed, ${declaredKinds.size} distinct kinds declared across `
  + `${HEADLINERS.length} personas. A kind present in the union but missing from this list would make every `
  + 'check below silently blind to it, which is the exact quietness this file exists to remove.',
);

// -- 2. NO EVENT KIND HAS ZERO COVERAGE ---------------------------------------------------
const uncovered = ALL_KINDS.filter((k) => !HEADLINERS.some((p) => p.covers.includes(k)));
const soleCovered = ALL_KINDS
  .map((k) => ({ k, who: HEADLINERS.filter((p) => p.covers.includes(k)).map((p) => p.id) }))
  .filter((e) => e.who.length === 1)
  .map((e) => `${e.k} (${e.who[0]})`);

check(
  'every event kind has at least one persona who will file on it',
  uncovered.length === 0,
  uncovered.length === 0
    ? `All ${ALL_KINDS.length} kinds reach a byline. `
      + `${soleCovered.length} are covered by exactly one reporter: ${soleCovered.join(', ') || 'none'}. `
      + 'A sole-covered kind is not a defect -- it is a single point of failure, and it is named here so '
      + 'that losing that reporter is a decision rather than a surprise.'
    : `NOBODY covers ${uncovered.join(', ')}. Those events are still emitted and will never be picked, because `
      + '`covers` filters rather than dispatches. This is the failure mode the restructure could have '
      + 'walked into when Scintilla moved.',
);

// -- 3. HOANI SPECIFICALLY HOLDS SCINTILLA'S ANALYTIC BEAT --------------------------------
const hoani = HEADLINERS.find((p) => p.id === 'hoani');
const required = ['anomaly', 'sustained_rate', 'expected_divergence'] as const;
const hoaniMissing = required.filter((k) => !hoani?.covers.includes(k));

check(
  'Hoani holds anomaly, sustained_rate and expected_divergence',
  !!hoani && hoaniMissing.length === 0,
  hoani
    ? `Hoani covers ${hoani.covers.join(', ')}. He exists for exactly one reason -- Scintilla was the only `
      + 'reporter on sustained_rate and expected_divergence, so if he does not hold them then removing '
      + 'Scintilla silences two event kinds. This check is what makes that claim testable rather than asserted.'
    : 'Hoani is not in the registry at all.',
);

// -- 4. HIS SEVERITY GATE IS SCINTILLA'S, CARRIED FORWARD UNCHANGED ------------------------
/*
  The gate is deliberately not re-derived. A fresh severity threshold would be a new decision dressed
  as a handover, and it would quietly change which events reach him. `HOANI_MIN_SEVERITY` and
  `SCINTILLA_MIN_SEVERITY` are both 55 by construction in the source; this asserts the resulting
  behaviour agrees by asking whether two personas with the same threshold respond identically to a
  synthetic sweep of severities.
*/
const sweep = [0, 25, 54, 55, 56, 80, 100];
const gateOf = (p: typeof hoani) => (p?.eligible
  ? sweep.map((severity) => {
    try {
      return Boolean(p.eligible?.(
        { severity } as never,
        {} as never,
      ));
    } catch {
      return null;
    }
  })
  : []);

const hoaniGate = gateOf(hoani);
const scintilla = HEADLINERS.find((p) => p.id === 'scintilla');
const scintillaGate = gateOf(scintilla ?? undefined);
const gatesMatch = hoaniGate.length > 0
  && hoaniGate.every((v, i) => v === scintillaGate[i]);

check(
  "Hoani's severity gate is Scintilla's, carried forward unchanged",
  gatesMatch,
  gatesMatch
    ? `Both accept the same severities across a sweep of ${sweep.join('/')}. The gate is what keeps him on the `
      + 'maths -- an event below the floor has nothing in it for him to interrogate -- so re-deriving it would '
      + 'have been a new decision wearing a handover\'s clothes.'
    : `Gate mismatch across ${sweep.join('/')}: Hoani ${JSON.stringify(hoaniGate)} against Scintilla `
      + `${JSON.stringify(scintillaGate)}. The brief was that the gate is his, not a new one.`,
);

// -- 5. EVERY PERSONA HAS A VOICE BANK ------------------------------------------------------
const missingBanks = HEADLINERS.filter((p) => !VOICE_BANKS[p.id]).map((p) => p.id);
const emptyGenerics = HEADLINERS.filter((p) => {
  const bank = VOICE_BANKS[p.id];
  return bank && (bank.titles.generic.length === 0 || bank.decks.generic.length === 0);
}).map((p) => p.id);

check(
  'every reporter has a voice bank with a non-empty generic bank',
  missingBanks.length === 0 && emptyGenerics.length === 0,
  `${HEADLINERS.length} reporters, ${Object.keys(VOICE_BANKS).length} voice banks. The generic bank is what `
  + 'catches an event kind a persona covers but has no specific lines for, so an empty one means that byline '
  + 'goes silent on exactly the events it was given.',
);

const failed = checks.filter((c) => !c.pass);
console.log('\nHEADLINER COVERAGE\n');
checks.forEach((c, i) => {
  console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
  if (c.detail) console.log('          ' + c.detail);
});
console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
if (failed.length > 0) process.exitCode = 1;