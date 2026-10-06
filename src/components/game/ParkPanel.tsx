import React from 'react';
import { parkProfile } from '../../lib/analytics/parkProfile';
import { ALL_PARK_FACTORS, parkFactorsFor, type ParkFactors } from '../../lib/analytics/parkFactors';
import type { Team } from '../../types';
import { FACTOR_BAR_RANGE, FATIGUE_BAR_RANGE } from '../../lib/parkGeometry';
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
      title={team ? `${team.city} ${team.name} Park` : 'Park'}
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
            <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
              Drawn to scale against the bar. Left-centre and right-centre are interpolated from the
              corners and centre at 12.5% and are not entered measurements; the other three are.
            </p>
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