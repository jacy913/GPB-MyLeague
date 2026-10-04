/**
 * Does `checkPlayoffElimination.ts` actually FAIL when these three fixes come back?
 *
 * ============================================================================
 * WHY THIS FILE IS NOT OPTIONAL
 * ============================================================================
 *
 * The bug this work started from -- a club eliminated in the first round still selling on its league
 * board -- survived a green test suite. So did the venue bug underneath it, twice: once in
 * `lockedRaces` during the exploit-closure work, and again here in `leagueSeriesLosers`. Both times
 * the fix was real and the suite was green and the product was still wrong.
 *
 * A guard that cannot fail is not a guard. Each of the five fixes below is re-injected into the real
 * source and the suite is required to notice.
 *
 * ============================================================================
 * THE FOUR WAYS THIS HARNESS LIED TO ITSELF, CARRIED OVER FROM THE LAST ONE
 * ============================================================================
 *
 *   1. `spawnSync` could not resolve the `npx` shim on Windows without `shell: true`, returned empty
 *      stdout with a null error, and reported "0 failures" for every injection -- which reads as "the
 *      guard does not work" when it actually means "nothing was measured". `ranNothing` below makes an
 *      empty run an explicit error.
 *   2. Injection anchors written with `\n` do not match a CRLF file, so the injection silently did
 *      nothing and looked exactly like a missed bug. Anchors are re-stamped per file.
 *   3. Two of the first six anchors were simply wrong about the code -- wrong indentation, and a
 *      variable that does not exist. "COULD NOT INJECT" is therefore treated as a FAILURE here, not a
 *      skipped test: an injection that cannot be applied is an assertion nobody made.
 *   4. One injection produced a module that would not compile, so the suite never ran. Also caught by
 *      `ranNothing` rather than being read as "the guard held".
 *
 * Run: node tools/provePlayoffEliminationGuard.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const runSuite = () => {
  const r = spawnSync('npx', ['tsx', 'tools/checkPlayoffElimination.ts'], {
    encoding: 'utf8',
    cwd: process.cwd(),
    shell: true, // see note 1
  });
  const out = `${r.stdout ?? ''}`;
  const fails = out.match(/^\s*FAIL\s+.*$/gm) ?? [];
  const passes = out.match(/^\s*PASS\s+/gm) ?? [];
  return {
    failed: fails.length,
    fails,
    // Nothing ran at all is an error, not a pass. See note 1 and note 4.
    ranNothing: passes.length === 0 && fails.length === 0,
    status: r.status,
    // Carried so an empty run can be DIAGNOSED rather than merely flagged. An earlier version of
    // this harness reported "the suite did not run" for an injection that in fact failed correctly,
    // which is how a flag ends up lying about the one thing it exists to report.
    head: `${r.stdout ?? ''}${r.stderr ?? ''}`
      .split(/\r?\n/).filter((l) => l.trim()).slice(0, 4).join(' | ').slice(0, 300),
  };
};

/**
 * The ORIGINAL `leagueSeriesLosers`, verbatim, reinjected as-is.
 *
 * Not a paraphrase of the old bug -- the actual old code, because reinjecting a lookalike would prove
 * the suite catches my sketch of the bug rather than the bug. This version counts `homeWins` against
 * `awayWins` and eliminates `row.away`, where `row.home` is whoever hosted game 1. Because a
 * best-of-seven alternates venues, a genuine 4-2 arrives as 2-2 and "level" means undecided, so the
 * function returns an empty set and eliminates nobody at all.
 */
const BUGGY_LEAGUE_SERIES_LOSERS = [
  'export const leagueSeriesLosers = (games: ReadonlyArray<LockedRaceGame>): Set<string> => {',
  '  const series = new Map<string, { home: string; away: string; homeWins: number; awayWins: number }>();',
  '  for (const game of games) {',
  "    if (game.status !== 'completed') continue;",
  "    if (game.playoff?.round !== 'league_series') continue;",
  '    const id = game.playoff?.seriesId ?? `${game.homeTeam}-${game.awayTeam}`;',
  '    const row = series.get(id) ?? {',
  '      home: game.homeTeam, away: game.awayTeam, homeWins: 0, awayWins: 0,',
  '    };',
  '    if (game.score.home > game.score.away) row.homeWins += 1;',
  '    else if (game.score.away > game.score.home) row.awayWins += 1;',
  '    series.set(id, row);',
  '  }',
  '',
  '  const eliminated = new Set<string>();',
  '  series.forEach((row) => {',
  '    if (row.homeWins > row.awayWins) eliminated.add(row.away);',
  '    else if (row.awayWins > row.homeWins) eliminated.add(row.home);',
  '  });',
  '  return eliminated;',
  '};',
].join('\n');

const CURRENT_LEAGUE_SERIES_LOSERS = [
  'export const leagueSeriesLosers = (games: ReadonlyArray<LockedRaceGame>): Set<string> => {',
  '  const eliminated = new Set<string>();',
  "  decidedFrom(seriesTallies(games, ['league_series'])).forEach((row) => {",
  '    const outcome = seriesOutcome(row);',
  '    if (outcome) eliminated.add(outcome.loserKey);',
  '  });',
  '  return eliminated;',
  '};',
].join('\n');

const injections = [
  {
    name: 'FIX 1 REINJECTED: leagueSeriesLosers counts home/away sides again',
    file: 'src/lib/futuresRisk.ts',
    swaps: [[CURRENT_LEAGUE_SERIES_LOSERS, BUGGY_LEAGUE_SERIES_LOSERS]],
    expect: 'the alternating-venue 4-2 reads 2-2 and nobody is eliminated',
  },
  {
    name: 'the loser counter is re-seeded at 0, so a sweep never records its loser',
    file: 'src/lib/futuresRisk.ts',
    swaps: [['  let loserWins = -1;', '  let loserWins = 0;']],
    expect: 'a 4-0 has the loser on zero wins, and 0 > 0 is false',
  },
  {
    name: 'FIX 2 REINJECTED: the postseason eliminations reach the DIVISION builder',
    file: 'src/components/betting/BettingPage.tsx',
    swaps: [[
      '...buildDivisionMarkets({ teams: input.teams, scoreBy, gamesRemainingByTeamId, eliminatedFromLeague, lockedRaces: locked }),',
      '...buildDivisionMarkets({ teams: input.teams, scoreBy, gamesRemainingByTeamId, eliminatedFromLeague, eliminatedFromPlayoff, lockedRaces: locked }),',
    ]],
    expect: 'a wild-card loser is greyed out as the division champion it still is',
  },
  {
    name: 'FIX 2 REINJECTED: the CHAMPIONSHIP board stops reading the postseason',
    file: 'src/components/betting/BettingPage.tsx',
    swaps: [[
      '      eliminatedFromLeague, eliminatedFromPlayoff, lockedRaces: locked,\n    }),',
      '      eliminatedFromLeague, lockedRaces: locked,\n    }),',
    ]],
    expect: 'the title board goes back to answering a postseason question with regular-season arithmetic',
  },
  {
    name: 'FIX 3 REINJECTED: the MVP races never close',
    file: 'src/components/betting/BettingPage.tsx',
    swaps: [[
      'buildAwardMarket(key, title, entries, { decided: regularSeasonOver })',
      'buildAwardMarket(key, title, entries, { decided: false })',
    ]],
    expect: 'a race decided in September is sellable for five weeks of playoffs',
  },
  {
    name: 'the award tie-break is removed, so a tie falls back to roster order',
    file: 'src/lib/awardRace.ts',
    // The anchors are JOINED rather than written as several array elements. Written as elements,
    // `swaps` destructures pairwise, so a five-line anchor became two swaps -- the first replacing
    // `.sort((left, right) => (` with the next line, which does not parse. The suite then failed to
    // transform and the run reported "nothing was measured" for an injection that bites correctly.
    // The `head` diagnostic added below is the only reason that was visible rather than baffling.
    swaps: [[
      [
        '    .sort((left, right) => (',
        '      left.total === right.total',
        '        ? left.name.localeCompare(right.name)',
        '        : right.total - left.total',
        '    ))',
      ].join('\n'),
      '    .sort((left, right) => right.total - left.total)',
    ]],
    expect: 'Zeb Andrews leads the input and ties on every term, so only a name break separates them',
  },
  {
    name: 'the pre-slice that capped every caller at eight comes back',
    file: 'src/lib/awardRace.ts',
    swaps: [[
      '    .slice(0, limit);',
      '    .slice(0, AWARD_FIELD_SIZE);',
    ]],
    expect: 'the archive asks for ten candidates and silently receives eight',
  },
];

let allBite = true;
let allInjected = true;

console.log('\nBASELINE');
{
  const r = runSuite();
  const clean = r.failed === 0 && !r.ranNothing;
  if (!clean) allBite = false;
  console.log(`  ${r.ranNothing
    ? '*** THE SUITE DID NOT RUN ***'
    : clean ? 'clean' : 'UNEXPECTED FAILURES'} -- ${r.failed} failing, status ${r.status}`);
  if (r.ranNothing) {
    console.log('\nAborting: a harness that cannot run the suite cannot prove anything.');
    process.exit(1);
  }
}

for (const injection of injections) {
  const original = readFileSync(injection.file, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let text = original;
  let ok = true;
  for (const [from, to] of injection.swaps) {
    const F = from.replace(/\n/g, eol);
    if (!text.includes(F)) { ok = false; break; }
    text = text.replace(F, to.replace(/\n/g, eol));
  }

  console.log(`\n${injection.name}`);
  console.log(`  expect: ${injection.expect}`);
  if (!ok) {
    // See note 3. A failed injection is a hole in the harness, not a skipped test.
    console.log('  COULD NOT INJECT -- the anchor text has moved.');
    allInjected = false;
    allBite = false;
  } else {
    writeFileSync(injection.file, text);
    try {
      const r = runSuite();
      const bites = r.failed > 0 && !r.ranNothing;
      if (!bites) allBite = false;
      console.log(`  ${r.ranNothing
        ? '*** THE SUITE DID NOT RUN, SO NOTHING WAS MEASURED ***'
        : bites ? 'BITES' : '*** DID NOT BITE ***'} -- ${r.failed} check(s) failed`);
      if (r.ranNothing) console.log(`    output was: ${r.head}`);
      for (const f of r.fails.slice(0, 3)) console.log(`    ${f.trim().slice(0, 120)}`);
      if (r.fails.length > 3) console.log(`    ...and ${r.fails.length - 3} more`);
    } finally {
      // Restored in a `finally`, so a crash mid-measurement cannot leave a bug in the tree.
      writeFileSync(injection.file, original);
    }
  }
}

console.log('\nRESTORED');
{
  const r = runSuite();
  const clean = r.failed === 0 && !r.ranNothing;
  if (!clean) allBite = false;
  console.log(`  ${clean ? 'clean again' : '*** STILL BROKEN ***'} -- ${r.failed} failing`);
  if (r.ranNothing) console.log(`    output was: ${r.head}`);
}

if (!allInjected) {
  console.log('\nAT LEAST ONE INJECTION COULD NOT BE APPLIED. Fix the anchors before trusting this.\n');
} else if (allBite) {
  console.log(`\nALL ${injections.length} INJECTED BUGS WERE CAUGHT. The guard holds.\n`);
} else {
  console.log('\nAT LEAST ONE INJECTED BUG SURVIVED. The guard is not trustworthy.\n');
}
process.exit(allBite && allInjected ? 0 : 1);
