/*
  DOES EVERY CLUB HAVE A SCOREBUG CODE, AND IS IT DISTINCT?

  The scorebug identifies a club by initials where the rest of the app identifies it by name. That
  makes the initials identity rather than decoration, which raises the stakes on the table compared to a
  caption: a missing entry prints `???` and a duplicated one prints the same three letters on two
  different bands.

  `teamColors.ts` keys `TEAM_INITIALS` by `TeamId`, so a club added without initials is a COMPILE error
  already. What TypeScript cannot see is the other two things:

    - an id in `INITIAL_TEAMS` that has no `TeamId` member (the palette check covers that, but only for
      the palette, and this file is the one that runs beside the scorebug)
    - two clubs sharing a code. Nothing in the type system objects to `'ALC': 'ALC', 'alo': 'ALC'`,
      and the result on screen is two unrelated clubs printing identical letters on adjacent bands.

  Both are cheap to assert and neither is visible in a screenshot of one game, because the collision
  would only show up on the slate where those two clubs happen to be drawn next to each other.
*/

import { INITIAL_TEAMS } from '../src/data/teams';
import { TEAM_INITIALS, clubInitials, type TeamId } from '../src/data/teamColors';

const problems: string[] = [];

const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

const main = () => {
  console.log('\nCLUB INITIALS -- every club, once, and readable as a code\n');

  const clubIds = INITIAL_TEAMS.map((team) => team.id);

  // 1. One entry per club. The type makes this a compile error for a known TeamId, so reaching a
  //    failure here means the club list and the palette have drifted apart.
  const missing = clubIds.filter((id) => !TEAM_INITIALS[id as TeamId]);
  check(
    'every club in INITIAL_TEAMS has a code',
    missing.length === 0,
    missing.length === 0
      ? `${clubIds.length} clubs, ${Object.keys(TEAM_INITIALS).length} codes`
      : `no code for: ${missing.join(', ')}`,
  );

  // 2. No code belongs to two clubs. This is the one that is genuinely invisible until two of the
  //    colliding clubs share a slate.
  const seen = new Map<string, string[]>();
  for (const id of clubIds) {
    const code = TEAM_INITIALS[id as TeamId];
    if (!code) continue;
    seen.set(code, [...(seen.get(code) ?? []), id]);
  }
  const collisions = [...seen.entries()].filter(([, ids]) => ids.length > 1);
  check(
    'and no code is shared by two clubs',
    collisions.length === 0,
    collisions.length === 0
      ? `${seen.size} distinct codes across ${clubIds.length} clubs`
      : collisions.map(([code, ids]) => `${code} -> ${ids.join(' + ')}`).join('; '),
  );

  // 3. Codes are three uppercase letters, which is the broadcast convention and also what the fixed-width
  //    run cell is sized against. A two-letter code would leave a visible gap; a four-letter one would
  //    overflow the column the initials share with the club name.
  const malformed = clubIds.filter((id) => {
    const code = TEAM_INITIALS[id as TeamId];
    return Boolean(code) && !/^[A-Z]{3}$/.test(code);
  });
  check(
    'and every code is three uppercase letters',
    malformed.length === 0,
    malformed.length === 0
      ? 'all codes match /^[A-Z]{3}$/'
      : `malformed: ${malformed.map((id) => `${id}='${TEAM_INITIALS[id as TeamId]}'`).join(', ')}`,
  );

  // 4. The fallback prints something visible rather than an empty cell, because a blank initials slot
  //    reads as a rendering fault and `???` reads as an unknown club.
  check(
    'an unknown club id still prints a visible placeholder',
    clubInitials('not-a-club') === '???' && clubInitials(null) === '???',
    `clubInitials('not-a-club') = '${clubInitials('not-a-club')}', clubInitials(null) = '${clubInitials(null)}'`,
  );

  console.log('');
  console.log('  the codes as the scorebug will print them:');
  const perRow = 8;
  const ids = INITIAL_TEAMS.map((t) => t.id);
  for (let row = 0; row < Math.ceil(ids.length / perRow); row += 1) {
    const slice = ids.slice(row * perRow, row * perRow + perRow);
    console.log(`    ${slice.map((id) => `${id.toUpperCase()}=${clubInitials(id)}`).join('  ')}`);
  }
  console.log('');

  if (problems.length) {
    problems.forEach((p) => console.log(`  FAIL  ${p}`));
    console.log(`\n  ${problems.length} problem(s).\n`);
    process.exit(1);
  }
  console.log('  every band can name its club in three letters, and no two bands say the same one.\n');
};

main();