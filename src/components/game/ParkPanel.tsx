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
 * Seven months of temperature as a small bar chart.
 *
 * SCALED ACROSS THE SEASON, NOT FROM ZERO, and the reason is that the absolute range is the
 * opposite of intuitive here. A cold park runs -5 to 6 C and a hot one 27 to 47 C, so a zero-based
 * bar makes both look like small stubs in the bottom corner of a very tall empty chart, and the
 * difference between a desert and a maritime north -- which is the entire point -- disappears.
 *
 * Every value is printed under its column, so the scaling never costs the reader the number. What
 * it does cost is an absolute comparison BETWEEN parks, and that is a real limitation rather than
 * an oversight: Desseldein at 34-47C and Houssen at -6 to 7C draw an identically-shaped chart,
 * because each is scaled to its own season. The panel shows one park at a time and the common
 * question is "what is this place like across the season", so shape wins and the printed numbers
 * and the annual mean in the heading carry the absolutes. A shared league-wide scale would make
 * the two comparable and would flatten each park's own curve to about a quarter of the chart.
 */
const MonthTemperatures: React.FC<{ profile: ParkProfile }> = ({ profile }) => {
  const temps = climateMonthC(profile);
  const coldest = Math.min(...temps);
  const warmest = Math.max(...temps);
  const span = Math.max(1, warmest - coldest);

  return (
    <div className="mt-3 flex items-end gap-1.5">
      {CLIMATE_MONTHS.map((month, i) => {
        const temp = temps[i];
        const share = (temp - coldest) / span;
        return (
          <div key={month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            {/* `flex-1` height with a percentage child is how a column is anchored to the row's
                floor without a fixed pixel height, so the row scales with whatever the panel is
                given rather than being tuned once. */}
            <div className="flex h-16 w-full items-end">
              <span
                className="block w-full bg-[var(--color-warn)]"
                style={{ height: `${(share * 100).toFixed(1)}%`, opacity: 0.45 + share * 0.45 }}
                aria-hidden="true"
              />
            </div>
            <span className="t-caption text-[var(--color-ink-dim)] tabular-nums">{temp}&deg;</span>
            <span className="t-caption text-[var(--color-ink-faint)]">{month}</span>
          </div>
        );
      })}
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

              THE BAR IS DRAWN FROM THE SEASON'S OWN RANGE, not from zero, and that is a real
              choice rather than a shortcut. A zero-based bar would make every park look mild --
              Foulles at 28-36 C and Feyford at -5-6 C would both be short stubs off a shared
              baseline, because the interesting range is 40 C wide and neither end is near zero.
              Scaling to the coldest and warmest month ON SCREEN is what makes "this is a desert"
              and "this is a maritime north" comparable at a glance, and the numbers are printed
              beside every column so the reader can still read the absolute value. The one thing
              this cannot do is show a park as warm or cool in absolute terms, and the annual mean
              is printed under the row precisely so that comparison stays available.
            */}
            <div className="mt-5 border-t border-[var(--color-chrome-lo)] pt-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="t-label text-[var(--color-ink-faint)]">THE SEASON</p>
                <p className="t-caption text-[var(--color-ink-faint)]">
                  annual mean {profile.climateCUsed}&deg;C
                </p>
              </div>
              <MonthTemperatures profile={profile} />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
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
              THE WORKING. All ten terms, each on its own league-relative scale, with the largest
              deviation from neutral picked out in gold.

              The highlight is the same gesture the app already makes on the leaderboards, where the
              column a reader is meant to follow is the one lit up. Here it answers "what is this park
              actually about" in one glance: a big park with thin air leads on wall distance and air
              carry, and the two rows that explain it are the two that glow.
            */}
            <div className="border-t border-[var(--color-chrome-lo)] pt-4">
              <p className="t-label text-[var(--color-ink-faint)]">WHAT'S DRIVING IT</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {(Object.keys(factors.terms) as (keyof ParkFactors['terms'])[]).map((key) => {
                  const value = factors.terms[key];
                  const range = TERM_RANGES[key];
                  const span = Math.max(1e-6, range.max - range.min);
                  const share = (value - range.min) / span;
                  const dominant = Math.abs(value - 1) === Math.max(
                    ...(Object.keys(factors.terms) as (keyof ParkFactors['terms'])[])
                      .map((k) => Math.abs(factors.terms[k] - 1)),
                  );
                  return (
                    <div key={key} className="flex items-center gap-2">
                      {/*
                        `w-[12ch]`, not `w-[9ch]`. At nine characters "Wall distance", "Wall height",
                        "Wall colour" and "Foul ground" all rendered as "Wall dist…", so the four
                        terms that describe the wall itself were the four whose names were cut off.
                      */}
                      <span
                        className="w-[12ch] shrink-0 t-caption truncate"
                        style={{ color: dominant ? 'var(--color-gold-hi)' : 'var(--color-ink-faint)' }}
                      >
                        {TERM_LABELS[key]}
                      </span>
                      <span className="relative h-1.5 min-w-0 flex-1 bg-[var(--color-sunken)]">
                        <span
                          className="absolute inset-y-0 left-0"
                          style={{
                            width: `${(share * 100).toFixed(1)}%`,
                            background: dominant ? 'var(--color-gold)' : 'var(--color-chrome-mid)',
                          }}
                          aria-hidden="true"
                        />
                      </span>
                      <span
                        className="w-[5ch] shrink-0 text-right t-stat-sm tabular-nums"
                        style={{ color: dominant ? 'var(--color-gold-hi)' : 'var(--color-ink-dim)' }}
                      >
                        {value.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
                Bars show where this park sits on each dimension against the other thirty-one. The
                number is the multiplier itself.
              </p>
            </div>

            {/*
              THE PARK ITSELF: the eleven hand-entered dimensions, as readouts.

              These are the only fields in the whole model that a human chose. Everything above is
              computed from them, which is what `parks.json` insists on in its own header -- a
              hand-set factor would silently disagree with the dimensions above it.
            */}
            <div className="border-t border-[var(--color-chrome-lo)] pt-4">
              <p className="t-label text-[var(--color-ink-faint)]">THE PARK</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                {([
                  ['Town', profile.parkCity ?? '—'],
                  ['Roof', humanise(profile.dimensions.roof)],
                  ['Wall', `${profile.dimensions.wallHeightFt} ft ${humanise(profile.dimensions.wallColor)}`],
                  ['Altitude', `${humanise(profile.dimensions.altitude)} · ${Math.round(profile.altitudeFtUsed).toLocaleString()} ft`],
                  ['Climate', `${humanise(profile.dimensions.climate)} · ${Math.round(profile.climateCUsed)}°C`],
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