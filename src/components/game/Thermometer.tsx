import React from 'react';
import { formatTemperatureF } from '../../lib/gameTemperature';

/**
 * ============================================================================
 * THE FIELD THERMOMETER
 * ============================================================================
 *
 * A game's field weather is one number, and a number in a box -- "46F" -- does not say whether that
 * is a cold night or a warm afternoon until it is compared with something. A thermometer says it in
 * one glance: blue at the cold end, red at the hot end, and a marker on the line where this game
 * sits. That is the whole component, and it exists because the reading is the point of the tile.
 *
 * THE SCALE IS FIXED ACROSS THE LEAGUE, AND THAT IS THE DESIGN
 *
 * If every thermometer stretched its own coldest and warmest game across the full track, a 46F night
 * in April and a 46F day in a retractable-roof park would look identical in two differently-shaped
 * meters, and "colder" would mean nothing across two games. So the track is one fixed span for every
 * game: THERMOMETER_FLOOR_F at the left edge, THERMOMETER_CEILING_F at the right, chosen to cover the
 * league's whole game-time range (measured at roughly 19F to 114F) with a little margin at each end,
 * so a game's position on the line is comparable with every other game's.
 *
 * A value outside the span pins to the nearest edge rather than flying off the track -- it cannot,
 * by the range above, but the clamp keeps a future data change from drawing a marker outside its own
 * meter.
 */

/** The cold end of the track, Fahrenheit. At or below this the marker pins to the left edge. */
export const THERMOMETER_FLOOR_F = -20;

/** The hot end of the track, Fahrenheit. At or above this the marker pins to the right edge. */
export const THERMOMETER_CEILING_F = 120;

/**
 * Blue through to red, warm through the middle -- the conventional temperature scale, so the colour
 * reads before the number does. Deliberately not the app's gold/chrome palette: a thermometer that
 * is on-palette would stop being a thermometer.
 */
const TRACK_GRADIENT =
  'linear-gradient(90deg, #1d4ed8 0%, #38bdf8 24%, #fde047 52%, #f97316 78%, #dc2626 100%)';

export const Thermometer: React.FC<{ valueF: number }> = ({ valueF }) => {
  const span = THERMOMETER_CEILING_F - THERMOMETER_FLOOR_F;
  const ratio = Math.min(1, Math.max(0, (valueF - THERMOMETER_FLOOR_F) / span));
  const markerLeft = ratio * 100;
  const reading = formatTemperatureF(valueF);

  return (
    <div className="w-full" role="img" aria-label={`Field weather ${reading}`} title={`Field weather ${reading}`}>
      <div className="relative h-3">
        <div
          className="absolute inset-0 rounded-full border border-[var(--color-chrome-lo)]"
          style={{ background: TRACK_GRADIENT }}
          aria-hidden="true"
        />
        {/*
          The marker is a line that stands proud of the track at both ends, so it reads as a needle
          on a gauge rather than a division of the gradient. White with a dark ring, because it has
          to stay visible over the whole blue-to-red span.
        */}
        <span
          className="absolute top-1/2 h-[18px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-1 ring-black/70"
          style={{ left: `${markerLeft}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="mt-1 text-center t-stat-sm tabular-nums">{reading}</div>
    </div>
  );
};
