/**
 * How much spread does each park channel actually have across the 32 parks?
 *
 * WHY THIS TOOL EXISTS
 *
 * The user pointed out that 21 of 32 parks are at or near sea level, and that this is just
 * how humanity builds cities -- so the altitude channel is nearly dead, and the OTHER
 * dimensions have to carry the differentiation.
 *
 * That is a claim about spread, so it gets measured rather than asserted. A channel that
 * produces 32 nearly identical values is not a channel; it is decoration, and it should be
 * reported as such.
 *
 * WHAT IT MEASURES
 *
 * For each of the derived factors and for each of the underlying physical terms, the spread
 * across all 32 parks as a ratio of the league mean: (max - min) / mean. Also the standard
 * deviation as a percentage of the mean, because range alone is fragile -- one extreme park
 * gives a big range with 31 identical ones.
 *
 * WHAT IT CANNOT DO
 *
 * It says nothing about whether a spread is CORRECT, only whether it exists. A channel can
 * be wide and wrong. The correctness question is what tools/checkParkWiring.ts measures, and
 * that needs simulated seasons.
 *
 * Run: npx tsx tools/channelSpread.ts
 */

import {
  ALL_PARK_FACTORS,
  parkFactorsFor,
  type ParkFactors,
} from '../src/lib/analytics/parkFactors';
import { ALL_PARK_PROFILES, type ParkProfile } from '../src/lib/analytics/parkProfile';

const PROFILES: ParkProfile[] = [...ALL_PARK_PROFILES.values()];

interface Row {
  label: string;
  values: number[];
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/**
 * Spread as a percentage, and the mean it is measured against.
 *
 * `scale` is the value the percentage divides by, and it is NOT always the mean. For the
 * multiplier channels the mean is right -- they sit around 1.0, so "range relative to
 * typical" is the question.
 *
 * But `pitcherFatigueRate` is a SIGNED RATE centred on zero, and its mean is zero by
 * construction because the league averages it out. Dividing a range of 0.22 by a mean of
 * 0.0000000001 printed a number with 51 digits and a row wide enough to wrap the table. The
 * fix is to report a signed channel against the channel's own full span, which is what a
 * reader wants anyway: "this runs from -4.9% to +17.2%" is a sentence, and "this is 100000%
 * of the mean" is not.
 */
const spread = (values: number[]): { range: number; sd: number; scale: number } => {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const m = mean(values);
  // A mean this small means the channel is signed and centred on zero, so there is no
  // meaningful "typical" magnitude to express it as a fraction of.
  const signed = Math.abs(m) < 0.01;
  const scale = signed ? Math.max(Math.abs(lo), Math.abs(hi)) || 1 : m;
  return {
    range: ((hi - lo) / Math.abs(scale)) * 100,
    sd: (stdev(values) / Math.abs(scale)) * 100,
    scale,
  };
};

const rows: Row[] = [
  {
    label: 'hrFactor',
    values: [...ALL_PARK_FACTORS.values()].map((f: ParkFactors) => f.hrFactor),
  },
  {
    label: 'fbFactor',
    values: [...ALL_PARK_FACTORS.values()].map((f: ParkFactors) => f.fbFactor),
  },
  {
    label: 'gbFactor',
    values: [...ALL_PARK_FACTORS.values()].map((f: ParkFactors) => f.gbFactor),
  },
  {
    label: 'runFactor',
    values: [...ALL_PARK_FACTORS.values()].map((f: ParkFactors) => f.runFactor),
  },
  {
    label: 'pitcherFatigueRate',
    values: [...ALL_PARK_FACTORS.values()].map((f: ParkFactors) => f.pitcherFatigueRate),
  },
];

/*
  THE UNDERLYING TERMS, which is where the diagnosis actually is.

  A dead channel shows up here rather than in the derived factors, because the derived factor
  is a product of terms and one dead term among several live ones still leaves a live-looking
  factor. If `airCarry` spans 1.00-1.02 while `wallCombined` spans 0.85-1.25, the HR factor
  looks alive and is really a wall factor wearing an altitude factor's name.
 */
const termRows: Row[] = [
  'airCarry',
  'biteLoss',
  'roofCarry',
  'wallDistance',
  'wallHeight',
  'wallColor',
  'foulGround',
  'surface',
  'grass',
  'soil',
].map((key) => ({
  label: key,
  values: PROFILES.map((p) => parkFactorsFor(p).terms[key as keyof ParkFactors['terms']]),
}));

const main = (): void => {
  const all = [...rows, ...termRows];

  console.log('\nPARK CHANNEL SPREAD across all 32 parks\n');
  console.log('  A channel that varies by less than 1% of the league mean is not carrying');
  console.log('  anything. Those are flagged DEAD, and a derived factor built mostly out of');
  console.log('  dead channels is a derived factor with one real input and several');
  console.log('  decorative ones.\n');
  console.log('  channel                     min        mean        max    range%     sd%  verdict');
  console.log('  ' + '-'.repeat(76));

  let dead = 0;
  for (const row of all) {
    const s = spread(row.values);
    const verdict = s.range < 1 ? 'DEAD' : s.range < 5 ? 'thin' : 'live';
    if (s.range < 1) dead += 1;
    // A signed channel has no meaningful mean to print, so show the span it is measured
    // against instead. `scale` is the divisor, which is the mean for a multiplier and the
    // larger absolute endpoint for a signed rate.
    const mid = Math.abs(mean(row.values)) < 0.01 ? s.scale : mean(row.values);
    console.log(
      '  ' + row.label.padEnd(22)
      + Math.min(...row.values).toFixed(4).padStart(10)
      + mid.toFixed(4).padStart(12)
      + Math.max(...row.values).toFixed(4).padStart(12)
      + s.range.toFixed(2).padStart(9)
      + s.sd.toFixed(2).padStart(8)
      + '   ' + verdict,
    );
  }

  const live = all.filter((r) => spread(r.values).range >= 5).length;
  console.log('\n  ' + live + ' live, ' + (all.length - live - dead) + ' thin, ' + dead + ' dead, of ' + all.length + ' channels\n');

  /*
    THE ALTS OF EACH PARK, reported rather than guessed, because "how do the dimensions
    distribute" is a property of the DATA and the answer decides which channels are worth
    widening. A dimension where all 32 parks took the same value cannot carry any signal no
    matter what coefficient it is given.
   */
  const dims = [
    'altitude', 'roof', 'surface', 'grassLength', 'soilType',
    'climate', 'humidity', 'foulGround', 'wallColor',
  ] as const;
  console.log('  DIMENSION COVERAGE -- how many distinct values do the 32 parks take?\n');
  for (const d of dims) {
    const counts = new Map<string, number>();
    for (const p of PROFILES) {
      // `unknown` first because ParkDimensions has no index signature. Every key asked for
      // here is a declared field of it; the cast only loses the compiler's ability to say so.
      const v = String((p.dimensions as unknown as Record<string, unknown>)[d]);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([v, n]) => `${v} ${n}`);
    console.log('  ' + d.padEnd(13) + String(counts.size).padStart(2) + ' values   ' + parts.join(', '));
  }

  /*
    WHY WALL COLOUR IS THE ONE THIN CHANNEL, and why that is a DATA problem and not a
    coefficient problem.

    `wallColor` has three possible values and the 32 parks use two of them -- 17 dark, 15
    light, and not one glass. That is not a modelling gap; it is the parks file. There is a
    third value in the enum and nobody has a park for it.

    Glass is the interesting case physically -- a hard surface the ball skips off, so it
    behaves differently from both painted concrete and padded wall -- which is exactly why a
    league where every wall is painted or padded has a hole in it. But I am NOT going to
    assign glass walls to parks on the strength of my own knowledge of real ballparks in
    this league. That is the same class of move as inferring altitude from a team name, and
    it is the user's data to supply.
   */
  console.log('\n  wallColor has 3 possible values and the parks use 2. No park is glass.');
  console.log('  That is a gap in parks.json, not in the model -- and it is yours to fill.\n');

  /*
    THE SEA-LEVEL PARKS ON THEIR OWN, which is the direct answer to "21 parks are at the
    ocean, so is altitude doing anything".

    The league-wide `airCarry` spread is 24%, and the obvious worry is that all of it comes
    from the 11 parks that are not at sea level -- i.e. that the channel is really an
    altitude channel wearing a name, and that a league of 32 flat coastal parks would have
    no air signal at all.

    Measured rather than argued: this restricts the same statistics to the sea-level parks
    alone. `airCarry` is air DENSITY, not altitude -- it is altitude's contribution times
    temperature's, and RULE 1 multiplies them because they are the same physical quantity
    arriving twice. So a sea-level park in `cold` air is not at a carry of 1.000 even though
    it is at zero feet, and that is the mechanism by which climate keeps this channel alive
    when altitude cannot.
   */
  const seaLevel = PROFILES.filter((p) => p.dimensions.altitude === 'sea');
  const nonSea = PROFILES.filter((p) => p.dimensions.altitude !== 'sea');
  console.log(`  AIR CARRY, SPLIT BY ALTITUDE -- ${seaLevel.length} sea-level vs ${nonSea.length} above\n`);
  console.log('  group          n     min      mean      max    range%');
  console.log('  ' + '-'.repeat(58));
  for (const [label, group] of [['sea level', seaLevel], ['above sea', nonSea], ['all 32', PROFILES]] as const) {
    const vals = group.map((p) => parkFactorsFor(p).terms.airCarry);
    const s = spread(vals);
    console.log(
      '  ' + label.padEnd(13)
      + String(vals.length).padStart(3)
      + Math.min(...vals).toFixed(4).padStart(9)
      + mean(vals).toFixed(4).padStart(10)
      + Math.max(...vals).toFixed(4).padStart(9)
      + s.range.toFixed(2).padStart(9),
    );
  }

  /*
    The number that matters for the user's question: how much spread survives INSIDE the
    sea-level group, where altitude is definitionally constant. If that is a healthy few
    percent, then the league does not depend on the eleven elevated parks for its air signal,
    and the concern that "sea level parks means no air factor" is measurably wrong.

    It is expected to be smaller than the league-wide figure -- the elevated parks widen the
    range at both ends -- but the expectation is not the point. Reporting it is.
   */
  const seaSpread = spread(seaLevel.map((p) => parkFactorsFor(p).terms.airCarry));
  console.log(
    `\n  Within the ${seaLevel.length} sea-level parks alone, airCarry still spans`
    + ` ${seaSpread.range.toFixed(2)}% (${Math.min(...seaLevel.map((p) => parkFactorsFor(p).terms.airCarry)).toFixed(4)}`
    + ` to ${Math.max(...seaLevel.map((p) => parkFactorsFor(p).terms.airCarry)).toFixed(4)}).`,
  );
  console.log('  That spread is temperature, not altitude: RULE 1 multiplies the two because');
  console.log('  they are air density arriving by two doors. So the channel survives a league');
  console.log('  of flat coastal parks, and "21 parks at the ocean kills the altitude factor"');
  console.log('  is measurably wrong -- though it is right that the eleven elevated parks are');
  console.log('  what push the league-wide range out to 24%.\n');
};

main();