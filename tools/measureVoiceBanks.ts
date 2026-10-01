/**
 * How thin is each voice bank, and where?
 *
 * Run before adding a single template, because "more things to say" is a number and
 * the number has never been measured per cell.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 *
 * `render` in headlinerVoices.ts documents three failed attempts at an anti-repetition
 * memory, all measured against their own no-memory baseline, and concludes that seeded
 * selection is already near-optimal: only 9.1% of cards repeat their own byline's line
 * from the previous day.
 *
 * So the memory is NOT the lever, and adding one would be re-running a rejected
 * experiment. But that same comment records the reason the residual 9.1% is not zero:
 *
 *   "staff_wins publishes ~2,446 cards a season from 8 templates, so some adjacent
 *    pair MUST collide -- no amount of extra prose fixes a birthday problem."
 *
 * That is a statement about bank SIZE. A birthday collision is unavoidable at a given
 * count; the only cure is a larger bank. So template count is the one measured lever
 * for repetition, and the plan's own target (~196 titles, ~132 decks) was left at
 * roughly 60% deliberately, pending a season of reading.
 *
 * This reports the per-cell distribution so the fill can be aimed at the cells that
 * are actually thin rather than spread evenly.
 *
 * Run: npx tsx tools/measureVoiceBanks.ts
 */

import { HEADLINERS, type GameEventKind } from '../src/logic/headliners';
import { VOICE_BANKS } from '../src/logic/headlinerVoices';

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

const main = (): void => {
  console.log('\nVOICE BANK COVERAGE\n');

  let totalTitles = 0;
  let totalDecks = 0;
  const thinCells: Array<{ who: string; kind: string; titles: number; decks: number; covered: boolean }> = [];

  HEADLINERS.forEach((persona) => {
    const bank = VOICE_BANKS[persona.id];
    const covered = new Set(persona.covers);

    let personaTitles = 0;
    let personaDecks = 0;
    const rows: string[] = [];

    ALL_KINDS.filter((kind) => covered.has(kind)).forEach((kind) => {
      const titles = bank.titles[kind]?.length ?? 0;
      const decks = bank.decks[kind]?.length ?? 0;
      personaTitles += titles;
      personaDecks += decks;
      rows.push(
        `  ${kind.padEnd(20)} titles ${String(titles).padStart(2)}   decks ${String(decks).padStart(2)}` +
        (titles < 4 || decks < 3 ? '   <- thin' : ''),
      );
      if (titles < 4 || decks < 3) {
        thinCells.push({ who: persona.displayName, kind, titles, decks, covered: true });
      }
    });

    const genericTitles = bank.titles.generic.length;
    const genericDecks = bank.decks.generic.length;
    personaTitles += genericTitles;
    personaDecks += genericDecks;
    totalTitles += personaTitles;
    totalDecks += personaDecks;

    console.log(`  ${persona.displayName} (${persona.id}) - covers ${covered.size} kinds`);
    console.log(rows.join('\n'));
    console.log(
      `  ${'generic (all kinds)'.padEnd(20)} titles ${String(genericTitles).padStart(2)}   decks ${String(genericDecks).padStart(2)}\n`,
    );
  });

  // Every kind every persona does NOT cover still falls back to generic, so a kind
  // nobody writes about is only reachable through the generic bank.
  const coveredEverywhere = new Set(
    HEADLINERS.flatMap((p) => [...p.covers]),
  );
  const orphans = ALL_KINDS.filter((kind) => !coveredEverywhere.has(kind));

  console.log('  SUMMARY');
  console.log(`    titles in play        ${totalTitles}`);
  console.log(`    decks in play         ${totalDecks}`);
  console.log(`    thin cells (<4 titles or <3 decks): ${thinCells.length}`);
  console.log(`    event kinds NO persona covers        : ${orphans.length}` +
    (orphans.length > 0 ? `  -> ${orphans.join(', ')}` : ''));

  if (thinCells.length > 0) {
    console.log('\n  THIN CELLS, BY SEVERITY');
    thinCells
      .sort((a, b) => (a.titles + a.decks) - (b.titles + b.decks))
      .forEach((cell) => {
        console.log(
          `    ${cell.titles + cell.decks === 0 ? 'EMPTY ' : ''}${cell.who.padEnd(18)} ${cell.kind.padEnd(20)} t${cell.titles} d${cell.decks}`,
        );
      });
  }

  console.log(
    '\n  A birthday collision is unavoidable at a given bank size. This is the one\n' +
    '  measured lever on repetition; the anti-repetition memory was tried three ways\n' +
    '  and made the figure worse every time.',
  );
  console.log();
};

main();