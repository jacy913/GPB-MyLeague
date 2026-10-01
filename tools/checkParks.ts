/**
 * Does `parks.json` agree with the league?
 *
 * Not a style check. The plan's risk 4.3 is that a half-filled park file loads silently
 * and produces a league where some clubs play at 5,000 feet and the rest play at sea
 * level, with nothing on screen saying which is which. A park is the largest single
 * lever on scoring in the engine, so a bad park file does not look broken -- it looks
 * like a league that inexplicably has one enormous scoring team.
 *
 * So the validator refuses rather than defaults. Every missing field, unknown team id,
 * team missing a park, unknown enum value, and out-of-range number is an error, and this
 * tool exits non-zero if it finds one.
 *
 * It also reports the SPREAD, which is the thing that actually matters. A park file where
 * every club lands within 2% of every other club is valid JSON and completely inert, and
 * that is not visible from reading the file.
 *
 * Run: npx tsx tools/checkParks.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { INITIAL_TEAMS } from '../src/data/teams';

const HERE = dirname(fileURLToPath(import.meta.url));
const PARKS = resolve(HERE, '..', 'src', 'data', 'parks.json');

/**
 * The ten hand-picked decisions, and nothing else.
 *
 * Derived numbers are deliberately absent from both this list and the file. A hand-set
 * HR factor would silently disagree with the altitude and wall geometry above it, which
 * is a second source of truth for the same fact.
 */
const ENUMS = {
  altitude: ['sea', 'moderate', 'high', 'extreme'],
  roof: ['open_air', 'fixed_roof', 'retractable_open', 'dome'],
  wallColor: ['light', 'dark', 'glass'],
  surface: ['grass', 'turf', 'hybrid'],
  grassLength: ['short', 'standard', 'long'],
  soilType: ['dry_hard', 'standard_clay', 'damp_heavy', 'sandy_loose'],
  climate: ['cold', 'temperate', 'hot_dry', 'hot_humid', 'cool_coastal'],
  humidity: ['arid', 'moderate', 'humid'],
  foulGround: ['small', 'standard', 'generous'],
} as const;

const INTS: Record<string, { min: number; max: number }> = {
  lfFt: { min: 320, max: 400 },
  cfFt: { min: 380, max: 430 },
  rfFt: { min: 320, max: 400 },
  wallHeightFt: { min: 3, max: 40 },
};

const main = (): void => {
  const problems: string[] = [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(PARKS, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    console.log('\nFAIL  parks.json is not valid JSON.\n');
    console.log(`      ${(error as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  const teamIds = new Set(INITIAL_TEAMS.map((t) => t.id));
  const keys = Object.keys(parsed).filter((k) => !k.startsWith('_'));

  // --- ids agree in both directions -------------------------------------------------
  const missingPark = INITIAL_TEAMS.filter((t) => !keys.includes(t.id)).map((t) => t.id);
  if (missingPark.length > 0) {
    problems.push(`${missingPark.length} team(s) have no park: ${missingPark.join(', ')}`);
  }
  const unknownTeam = keys.filter((k) => !teamIds.has(k));
  if (unknownTeam.length > 0) {
    problems.push(`${unknownTeam.length} park(s) reference no team: ${unknownTeam.join(', ')}`);
  }

  // --- every field of every park ----------------------------------------------------
  const rows: Array<{ id: string; city: string; record: Record<string, unknown> }> = [];
  keys.filter((k) => teamIds.has(k)).forEach((id) => {
    const record = parsed[id] as Record<string, unknown>;
    const team = INITIAL_TEAMS.find((t) => t.id === id)!;
    if (typeof record !== 'object' || record === null) {
      problems.push(`${id}: entry is not an object`);
      return;
    }
    (Object.keys(ENUMS) as Array<keyof typeof ENUMS>).forEach((field) => {
      const value = record[field];
      if (value === undefined) {
        problems.push(`${id} (${team.city}): missing ${field}`);
        return;
      }
      if (!ENUMS[field].includes(value as never)) {
        problems.push(`${id} (${team.city}): ${field} = "${String(value)}", expected one of ${ENUMS[field].join(' | ')}`);
      }
    });
    Object.entries(INTS).forEach(([field, range]) => {
      const value = record[field];
      if (value === undefined) {
        problems.push(`${id} (${team.city}): missing ${field}`);
        return;
      }
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        problems.push(`${id} (${team.city}): ${field} = "${String(value)}", expected an integer`);
        return;
      }
      if (value < range.min || value > range.max) {
        problems.push(`${id} (${team.city}): ${field} = ${value}, outside ${range.min}-${range.max}`);
      }
    });
    rows.push({ id, city: team.city, record });
  });

  // --- the spread, which validity cannot tell you -----------------------------------
  const cfValues = rows.map((r) => r.record.cfFt as number);
  const lfValues = rows.map((r) => r.record.lfFt as number);
  const rfValues = rows.map((r) => r.record.rfFt as number);
  const spread = (v: number[]) => (v.length ? Math.max(...v) - Math.min(...v) : 0);

  const altitudeCounts = new Map<string, number>();
  rows.forEach((r) => {
    const key = String(r.record.altitude);
    altitudeCounts.set(key, (altitudeCounts.get(key) ?? 0) + 1);
  });

  console.log('\nPARKS VALIDATION\n');
  console.log(`  teams in the league   ${INITIAL_TEAMS.length}`);
  console.log(`  parks in the file     ${keys.length}`);
  console.log(`  fields checked        ${Object.keys(ENUMS).length} enums + ${Object.keys(INTS).length} integers, per park`);

  console.log('\n  DISTRIBUTION');
  console.log(`    cfFt spread   ${Math.min(...cfValues)}-${Math.max(...cfValues)}  (range ${spread(cfValues)} ft)`);
  console.log(`    lfFt spread   ${Math.min(...lfValues)}-${Math.max(...lfValues)}  (range ${spread(lfValues)} ft)`);
  console.log(`    rfFt spread   ${Math.min(...rfValues)}-${Math.max(...rfValues)}  (range ${spread(rfValues)} ft)`);
  console.log(`    altitude      ${[...altitudeCounts.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`    roofs         ${[...new Set(rows.map((r) => r.record.roof))].join(', ')}`);

  // A file where every park is nearly identical is valid and useless.
  if (spread(cfValues) < 10 && spread(lfValues) < 10) {
    console.log(
      '\n  WARN  every centre-field distance is within 10 ft of every other. That is valid' +
        '\n        JSON and an inert park file: it cannot produce a spread in any derived' +
        '\n        factor. Widen the walls before Phase 3, or the archetype check has' +
        '\n        nothing to check.',
    );
  }

  if (problems.length > 0) {
    console.log(`\n  ${problems.length} PROBLEM(S)\n`);
    problems.forEach((p) => console.log(`    - ${p}`));
    console.log(
      '\n  These are refusals, not warnings. A park is the largest single lever on' +
        '\n  scoring in this engine, and a partially-filled file does not look broken --' +
        '\n  it looks like a league with one strange scoring team.\n',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n  ${INITIAL_TEAMS.length}/${INITIAL_TEAMS.length} parks valid. Every field present, every enum legal, every distance in range.\n`);
};

main();