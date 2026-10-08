import React from 'react';
import { parkProfile } from '../../lib/analytics/parkProfile';
import type { ParkProfile } from '../../lib/analytics/parkProfile';
import { ALL_PARK_FACTORS, type ParkFactors } from '../../lib/analytics/parkFactors';
import type { Team } from '../../types';
import { FACTOR_BAR_RANGE, FATIGUE_BAR_RANGE } from '../../lib/parkGeometry';
import {
  CLIMATE_MONTHS,
  climateMonthC,
  CORNER_INTERPOLATION,
  LEAGUE_SEASON_TEMP_C,
  toF,
  } from '../../lib/analytics/parkProfile';
import { Modal } from '../ui';
import { ParkField } from './ParkField';

/**
 * ============================================================================
 * THE PARK PANEL
 * ============================================================================
 *
 * The diagram answers "what shape is this park". The numbers beside it answer "what does that shape
 * DO to a game played in it", which is the question a manager actually has when they are looking at a
 * 24-foot wall in a hot, dry, tight-ground park.
 *
 * So the panel is two columns: the field, and the working. The field is the subject and the working is
 * the argument, and they are side by side so the two are read together rather than one after the
 * other.
 */

/**
 * Per-term ranges across the whole league, computed once at module load.
 *
 * THE TERMS CANNOT SHARE A SCALE, and this is the finding that shaped the panel.
 * `tools/reportParkFactorRanges.ts` measures all thirty-two parks: `wallDistance` deviates from
 * neutral by up to 0.332 while `wallColor` moves by at most 0.030. On one shared scale every term
 * except one is a flat line and the panel says "one thing matters" when ten do.
 *
 * So each term is normalised against ITS OWN range across the league. A bar then means "how extreme
 * is this park on this dimension", which is the comparison a reader wants, and the exact multiplier
 * is printed beside it so the absolute number is never more than an inch away.
 *
 * The alternative -- one shared scale, honest, and nine bars of nothing -- was the first version and
 * it made the working unreadable. This is the reason the ranges are computed rather than hardcoded:
 * they follow the data if `parks.json` ever changes.
 */
const TERM_RANGES = (() => {
  const rows = [...ALL_PARK_FACTORS.values()];
  const keys = Object.keys(rows[0].terms) as (keyof ParkFactors['terms'])[];
  const out = {} as Record<keyof ParkFactors['terms'], { min: number; max: number }>;
  for (const key of keys) {
    const values = rows.map((r) => r.terms[key]);
    out[key] = { min: Math.min(...values), max: Math.max(...values) };
  }
  return out;
})();

const TERM_LABELS: Record<keyof ParkFactors['terms'], string> = {
  airCarry: 'Air carry',
  biteLoss: 'Bite loss',
  wallDistance: 'Wall distance',
  wallHeight: 'Wall height',
  wallColor: 'Wall colour',
  foulGround: 'Foul ground',
  roofCarry: 'Roof carry',
  surface: 'Surface',
  grass: 'Grass',
  soil: 'Soil',
};

/** Human-facing chip text for the entered dimensions. */
const humanise = (value: string): string => value.replace(/_/g, ' ');

/** Plain-language labels for the 10 factor terms. */
const TERM_PLAIN_LABELS: Record<keyof ParkFactors['terms'], string> = {
  airCarry: 'Thin air',
  biteLoss: 'Less break on pitches',
  wallDistance: 'Short walls',
  wallHeight: 'Low walls',
  wallColor: 'Dark walls',
  foulGround: 'Generous foul territory',
  roofCarry: 'Open roof',
  surface: 'Turf surface',
  grass: 'Short grass',
  soil: 'Hard soil',
};

/** Group terms into intuitive categories for display. */
const TERM_GROUPS: Array<{ label: string; keys: Array<keyof ParkFactors['terms']> }> = [
  { label: 'Air & Altitude', keys: ['airCarry', 'biteLoss'] },
  { label: 'Walls', keys: ['wallDistance', 'wallHeight', 'wallColor'] },
  { label: 'Roof', keys: ['roofCarry'] },
  { label: 'Ground Game', keys: ['foulGround', 'surface', 'grass', 'soil'] },
];

/** Compute a park personality sentence from its factors. */
const getParkPersonality = (factors: ParkFactors): string => {
  const { hrFactor, runFactor, fbFactor, gbFactor } = factors;
  const hrIdx = Math.round(hrFactor * 100);
  const runIdx = Math.round(runFactor * 100);
  
  let personality = '';
  if (hrFactor >= 1.15) personality = 'A hitter\'s paradise — expect far more home runs than average. ';
  else if (hrFactor >= 1.05) personality = 'Friendly to hitters — home runs come easier here. ';
  else if (hrFactor <= 0.85) personality = 'A pitcher\'s haven — home runs are suppressed. ';
  else if (hrFactor <= 0.95) personality = 'Tough on hitters — the ball doesn\'t carry as far. ';
  else personality = 'Neutral on home runs — plays close to league average. ';

  if (runFactor >= 1.1) personality += 'Overall scoring runs well above average. ';
  else if (runFactor >= 1.03) personality += 'Slightly elevated scoring overall. ';
  else if (runFactor <= 0.9) personality += 'Scoring is notably suppressed. ';
  else if (runFactor <= 0.97) personality += 'Slightly lower scoring than average. ';
  else personality += 'Overall scoring near league average. ';

  if (fbFactor >= 1.1) personality += 'Fly balls carry well. ';
  else if (fbFactor <= 0.9) personality += 'Fly balls die at the track. ';

  if (gbFactor >= 1.08) personality += 'Ground balls find holes — lots of singles. ';
  else if (gbFactor <= 0.92) personality += 'Ground balls turn into outs. ';

  return personality.trim();
};

/** Get the top N driving terms by absolute deviation from 1.0. */
const getTopDrivers = (factors: ParkFactors, n = 3): Array<{ key: keyof ParkFactors['terms']; value: number; label: string }> => {
  const entries = Object.entries(factors.terms) as Array<[keyof ParkFactors['terms'], number]>;
  return entries
    .map(([key, value]) => ({ key, value, label: TERM_PLAIN_LABELS[key] }))
    .sort((a, b) => Math.abs(b.value - 1) - Math.abs(a.value - 1))
    .slice(0, n);
};

/**
 * A bar centred on neutral, for the four factors.
 *
 * 1.000 is the reference park and every park sits somewhere on either side of it. Gold above, teal
 * below -- direction, NOT good and bad, because a low run factor is a pitcher's park and a high one is
 * a hitter's and neither is an error. The panel deliberately does not moralise about which is better.
 */
const FactorBar: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const deviation = value - 1;
  const fraction = Math.min(1, Math.abs(deviation) / FACTOR_BAR_RANGE);
  const above = deviation >= 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-caption text-[var(--color-ink-faint)]">{label}</span>
        <span
          className="t-stat-sm tabular-nums"
          style={{ color: above ? 'var(--color-gold-hi)' : 'var(--color-neutral-hi)' }}
        >
          {value.toFixed(3)}
        </span>
      </div>
      <div className="relative mt-1 h-2 bg-[var(--color-sunken)]">
        {/* The neutral mark, so a factor near 1.000 visibly sits on the line rather than beside it. */}
        <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-chrome-hi)]" aria-hidden="true" />
        <span
          className="absolute inset-y-0"
          style={{
            background: above ? 'var(--color-gold)' : 'var(--color-neutral)',
            left: above ? '50%' : `${50 - fraction * 50}%`,
            width: `${fraction * 50}%`,
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
};

/**
 * The pitcher's fatigue rate, diverging from ZERO rather than from 1.000.
 *
 * It is a multiplier on the engine's own fatigue and it is signed: measured across the league it runs
 * -0.049 to +0.172, so every park either relieves a tiring arm or hastens it. Drawn from a neutral
 * centre like the factors, or from a single origin, the sign would be the one thing lost -- and the
 * sign is the entire content of the number. Hence a bar that grows left or right of the middle, with
 * the reading spelled out underneath.
 */
const FatigueBar: React.FC<{ value: number }> = ({ value }) => {
  const fraction = Math.min(1, Math.abs(value) / FATIGUE_BAR_RANGE);
  const faster = value >= 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-caption text-[var(--color-ink-faint)]">PITCHER FATIGUE</span>
        <span
          className="t-stat-sm tabular-nums"
          style={{ color: faster ? 'var(--color-warn)' : 'var(--color-neutral-hi)' }}
        >
          {value >= 0 ? '+' : ''}{value.toFixed(3)}
        </span>
      </div>
      <div className="relative mt-1 h-2 bg-[var(--color-sunken)]">
        <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-chrome-hi)]" aria-hidden="true" />
        <span
          className="absolute inset-y-0"
          style={{
            background: faster ? 'var(--color-warn)' : 'var(--color-neutral)',
            left: faster ? '50%' : `${50 - fraction * 50}%`,
            width: `${fraction * 50}%`,
          }}
          aria-hidden="true"
        />
      </div>
      <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
        {faster
          ? 'Relieves a tiring arm — the park wears pitchers down faster than the reference does.'
          : 'Hurts a tiring arm — pitchers recover here faster than at the reference park.'}
      </p>
    </div>
  );
};

/**
 * Seven months of temperature as a bar chart.
 *
 * ONE SCALE FOR THE WHOLE LEAGUE, WHICH REVERSES THE DECISION THIS COMPONENT WAS BUILT ON.
 *
 * It used to scale each park's bars to that park's own coldest and warmest month, and the comment
 * above the old version argued for it at length: a zero-based bar makes a desert and a maritime
 * north both look like stubs, and the panel shows one park at a time. That reasoning was sound and
 * the conclusion was wrong, because the per-park scale quietly answered a question nobody asked.
 * A park at -1C and a park at 14C drew identically-shaped charts that both filled the box, and
 * they are 15 degrees apart. The chart said "these places are alike" while the panel's own printed
 * numbers said they were not. Scaling to the league's range makes the shape an honest thing.
 *
 * The cost is real and worth naming: Houssen, the coldest park here, now draws bars about a fifth
 * the height of the box, which looks like a broken chart for about a second before it looks like a
 * cold place. That second impression is the correct one.
 *
 * FAHRENHEIT, because a reader looking at this panel is looking at a baseball park and 74F is the
 * number they would say out loud; 23C is a number they would have to convert in their head. The
 * data is still Celsius -- `climateMonthC` is unchanged and the physics has never seen this
 * component -- so this is a units change in one `toF` call and not a change of meaning.
 *
 * THE FLOOR IS THE LEAGUE'S COLDEST BASEBALL MONTH, not 0F, and not 0C either. Both of those sit
 * inside the league's range -- it runs from about 21F to 117F -- so freezing would still leave the
 * cold parks as stubs and the whole point would be made again by accident. Anchoring at the league
 * floor makes every bar proportional to how far above the coldest place on earth this park is.
 *
 * WHICH MEANS THE COLDEST MONTH IN THE LEAGUE IS EXACTLY ZERO HEIGHT, and a bar of nothing reads
 * as a broken chart rather than as the coldest place in the league. So the floor of 2% below is a
 * deliberate lie of the smallest available size: it makes the coldest column visible as a hairline.
 * It is 2% of 112px, about two pixels, and it is commented as what it is here rather than left to
 * look like a measurement.
 */
const MonthTemperatures: React.FC<{ profile: ParkProfile }> = ({ profile }) => {
  const temps = climateMonthC(profile);
  const { min, max } = LEAGUE_SEASON_TEMP_C;
  const span = Math.max(1, max - min);

  return (
    <div className="mt-3">
      <div className="flex items-end gap-1.5">
        {CLIMATE_MONTHS.map((month, i) => {
          const temp = temps[i];
          const share = (temp - min) / span;
          return (
            <div key={month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              {/* `flex-1` height with a percentage child is how a column is anchored to the row's
                  floor without a fixed pixel height, so the row scales with whatever the panel is
                  given rather than being tuned once. */}
              <div className="flex h-28 w-full items-end">
                <span
                  className="block w-full bg-[var(--color-warn)]"
                  style={{
                    height: `${(Math.max(0.02, share) * 100).toFixed(1)}%`,
                    opacity: 0.45 + share * 0.45,
                  }}
                  aria-hidden="true"
                />
              </div>
              <span className="t-caption text-[var(--color-ink-dim)] tabular-nums">
                {Math.round(toF(temp))}&deg;
              </span>
              <span className="t-caption text-[var(--color-ink-faint)]">{month}</span>
            </div>
          );
        })}
      </div>
      {/*
        THE AXIS, printed because a shared scale is unreadable without one. It names both ends and
        this park's own span, so a short column can be read as "cold place" rather than as "chart
        cut off" -- which without the numbers is exactly what a cold park looks like.
      */}
      <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
        Bars run from the league&rsquo;s coldest baseball month, {Math.round(toF(min))}&deg;F, to its
        warmest, {Math.round(toF(max))}&deg;F. Same scale for all 32 parks, so a short column means
        a cold place. This one runs {Math.round(toF(Math.min(...temps)))}&ndash;{Math.round(toF(Math.max(...temps)))}&deg;F.
      </p>
    </div>
  );
};

export const ParkPanel: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** The home club, whose park this game is being played in. */
  team: Team | undefined;
}> = ({ isOpen, onClose, team }) => {
  const profile = team ? parkProfile(team.id) : null;
  const factors = team ? ALL_PARK_FACTORS.get(team.id) ?? null : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      widthClass="max-w-6xl"
      title={team ? `${profile?.parkCity ?? team.city} Park` : 'Park'}
      barRight={(
        <span className="t-caption text-[var(--color-ink-faint)]">
          {profile ? `${Math.round(profile.wallAreaSqFt).toLocaleString()} sq ft of wall` : ''}
        </span>
      )}
    >
      {/*
        THE PARK THAT IS NOT THERE, and it is a real case rather than a defensive fiction.

        `parks.json` holds one entry per club in the shipped 32, but a league built from custom or
        imported clubs will have teams that are not in it. `gameEngine` handles that by playing the
        game with no park at all rather than with a wrong one, and this panel says exactly that
        instead of drawing an empty field or, worse, defaulting to some other club's dimensions.
      */}
      {!profile || !factors || !team ? (
        <p className="t-body text-[var(--color-ink-dim)]">
          {team
            ? `${team.city} ${team.name} has no park profile, so this game is being played with no park
               environment at all. Nothing is being approximated onto its behalf.`
            : 'No home club, so there is no park to show.'}
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div>
            <ParkField profile={profile} />
            {/*
              THE SUBTITLE, carrying the club whose park this is.

              Necessary the moment the park had a name, because the title stopped naming the club:
              "Greenpond Park" alone does not say whose ground it is, and this panel is reachable from
              a game between two clubs where the reader has just been looking at both. The one case
              where the two are the same word is `urb`, whose club city and park city are both
              Urbington -- harmless, and not worth a special case that would only read as clever.
            */}
            <p className="t-label mt-3 text-[var(--color-ink-dim)]">
              Home of the {team.city} {team.name}
            </p>
            <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
              Drawn to scale against the bar. Left-centre and right-centre are interpolated from the
              corners and centre at {Math.round(CORNER_INTERPOLATION * 100)}% and are not entered
              measurements; the other three are.
            </p>

            {/*
              THE SEASON, April to October, in the space under the map.

              It was the only large empty area left in the panel, and temperature is the one entered
              dimension that had no picture of any kind -- altitude is on the wall label, wall height
              is the thickness of the stroke, soil is the colour of the dirt, but a park's climate
              existed only as a word in a list.

              THE SCALE IS THE LEAGUE'S, not this park's. It used to be this park's own coldest and
              warmest month, and the argument for that -- written here at length when the component
              was built -- was that a zero-based bar makes a desert and a maritime north both look
              like stubs, and the panel shows one park at a time. The argument was sound and the
              outcome was not: scaling per park made a 21F park and a 111F park draw identical
              silhouettes, so the chart said "alike" while the numbers printed under it said
              otherwise. `MonthTemperatures` has the reasoning in full; this is the short version,
              and the short version is that a bar chart which cannot compare two bars is not a bar
              chart.
            */}
            <div className="mt-5 border-t border-[var(--color-chrome-lo)] pt-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="t-label text-[var(--color-ink-faint)]">THE SEASON</p>
                <p className="t-caption text-[var(--color-ink-faint)]">
                  annual mean {Math.round(toF(profile.climateCUsed))}&deg;F
                </p>
              </div>
              <MonthTemperatures profile={profile} />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {/* Park personality summary — plain language first */}
            <div className="bg-[var(--color-panel-2)] border border-[var(--color-chrome-lo)] p-3">
              <p className="t-body text-[var(--color-ink)]">{getParkPersonality(factors)}</p>
            </div>

            {/*
              THE FOUR OUTCOME FACTORS, which are what the park actually changes.

              These are the numbers the simulation consumes, so they lead. Everything below them is
              either how they were reached or what the park is made of.
            */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <FactorBar label="HOME RUNS" value={factors.hrFactor} />
              <FactorBar label="RUNS ALLOWED" value={factors.runFactor} />
              <FactorBar label="GROUND BALLS" value={factors.gbFactor} />
              <FactorBar label="FLY BALLS" value={factors.fbFactor} />
            </div>

            <div className="border-t border-[var(--color-chrome-lo)] pt-4">
              <FatigueBar value={factors.pitcherFatigueRate} />
            </div>

            {/*
              WHAT'S DRIVING IT — only the top 3 drivers, with plain labels.
              All bars use a unified league-percentile scale (0-100%, 50% = league average).
            */}
            <div className="border-t border-[var(--color-chrome-lo)] pt-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="t-label text-[var(--color-ink-faint)]">WHAT'S DRIVING IT</p>
                <span className="t-caption text-[var(--color-ink-faint)]">Top 3 factors</span>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {getTopDrivers(factors, 3).map(({ key, value, label }) => {
                  // League percentile: where this park sits among all 32 (0-100%)
                  const allValues = [...ALL_PARK_FACTORS.values()].map(f => f.terms[key]);
                  const sorted = [...allValues].sort((a, b) => a - b);
                  const rank = sorted.findIndex(v => v >= value);
                  const percentile = sorted.length > 1 ? (rank / (sorted.length - 1)) * 100 : 50;
                  const aboveAvg = value >= 1;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="w-[14ch] shrink-0 t-caption" style={{ color: 'var(--color-ink-faint)' }}>
                        {label}
                      </span>
                      <span className="relative h-2 min-w-0 flex-1 bg-[var(--color-sunken)]">
                        <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-chrome-hi)]" aria-hidden="true" />
                        <span
                          className="absolute inset-y-0"
                          style={{
                            background: aboveAvg ? 'var(--color-gold)' : 'var(--color-neutral)',
                            left: aboveAvg ? '50%' : `${50 - percentile / 2}%`,
                            width: `${percentile / 2}%`,
                          }}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="w-[5ch] shrink-0 text-right t-stat-sm tabular-nums" style={{ color: aboveAvg ? 'var(--color-gold-hi)' : 'var(--color-neutral-hi)' }}>
                        {value.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
                Bars show league percentile (50% = average). Number is the multiplier.
              </p>
            </div>

            {/*
              THE PARK ITSELF: key dimensions as readouts. Full list collapsed by default.
            */}
            <div className="border-t border-[var(--color-chrome-lo)] pt-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="t-label text-[var(--color-ink-faint)]">THE PARK</p>
                <button
                  type="button"
                  onClick={() => {}}
                  className="t-caption text-[var(--color-gold)] hover:underline"
                  aria-expanded="false"
                  aria-controls="park-dimensions-full"
                >
                  Show all 13 dimensions
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1" id="park-dimensions-full">
                {([
                  ['Town', profile.parkCity ?? '—'],
                  ['Roof', humanise(profile.dimensions.roof)],
                  ['Wall', `${profile.dimensions.wallHeightFt} ft ${humanise(profile.dimensions.wallColor)}`],
                  ['Altitude', `${profile.altitudeFtShown.toLocaleString()} ft`],
                  ['Climate', `${humanise(profile.dimensions.climate)} · ${Math.round(toF(profile.climateCUsed))}°F`],
                ]).map(([label, value]) => (
                  <div key={label} className="flex min-w-0 items-baseline justify-between gap-2">
                    <dt className="t-caption truncate text-[var(--color-ink-faint)]">{label}</dt>
                    <dd className="truncate t-stat-sm text-[var(--color-ink-dim)]">{value}</dd>
                  </div>
                ))}
              </dl>
              <details className="mt-2 group">
                <summary className="t-caption text-[var(--color-gold)] cursor-pointer select-none">
                  Show remaining dimensions
                </summary>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {([
                    ['Humidity', humanise(profile.dimensions.humidity)],
                    ['Foul ground', humanise(profile.dimensions.foulGround)],
                    ['Surface', humanise(profile.dimensions.surface)],
                    ['Grass', humanise(profile.dimensions.grassLength)],
                    ['Soil', humanise(profile.dimensions.soilType)],
                    ['Air density', `${profile.airDensityRatio.toFixed(3)}`],
                    ['Porch', `${profile.porchFt >= 0 ? '+' : ''}${profile.porchFt.toFixed(0)} ft ${profile.porchFt > 0 ? 'left' : profile.porchFt < 0 ? 'right' : 'even'}`],
                    ['Mean wall', `${Math.round(profile.meanWallFt)} ft`],
                  ]).map(([label, value]) => (
                    <div key={label} className="flex min-w-0 items-baseline justify-between gap-2">
                      <dt className="t-caption truncate text-[var(--color-ink-faint)]">{label}</dt>
                      <dd className="truncate t-stat-sm text-[var(--color-ink-dim)]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

/** Exported for the caller's own guard: is there a park to show for this club at all? */
export const hasPark = (teamId: string | undefined): boolean =>
  teamId !== undefined && ALL_PARK_PROFILES_HAS(teamId);

/** Tiny indirection so the panel and this predicate cannot disagree about what "has a park" means. */
const ALL_PARK_PROFILES_HAS = (teamId: string): boolean => parkProfile(teamId) !== null;