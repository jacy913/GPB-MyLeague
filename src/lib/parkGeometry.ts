/**
 * ============================================================================
 * TURNING FIVE NUMBERS INTO A FIELD
 * ============================================================================
 *
 * A park is entered as three wall distances and a wall height. This module turns that into the
 * outline you can look at, and it exists as a separate file from the component that draws it because
 * every decision in here is arithmetic that can be checked, and none of it is styling.
 *
 * Bearings. Home plate is the origin and straight to dead centre is bearing 0, positive to the
 * right, so the LEFT field corner is at NEGATIVE 45. That sign convention is the single easiest thing
 * to get backwards in a file like this, and getting it backwards draws a mirror-image park that still
 * looks plausible -- so it is stated here rather than inferred at each use.
 *
 *   -45 deg  LF   -22.5  LCF   0  CF   +22.5  RCF   +45  RF
 *
 * The 22.5 steps are not arbitrary: the foul lines are at 45, and LCF/RCF are interpolated at 12.5%
 * of the gap between a corner and centre, which is exactly a quarter of the way along the arc. The
 * five labels therefore sit at their true bearings, which is what lets a leader line mean anything.
 *
 * WHY A SMOOTH CURVE AND NOT FIVE STRAIGHT LINES. Interpolating linearly between the control points
 * produces a visible kink at each one, so a park reads as a pentagon. Smoothstep (3t^2 - 2t^3) passes
 * through the same five values with zero slope at each, which is both continuous and close enough to
 * the way a real fence bends. Sampled at 4-degree steps the polyline is indistinguishable from the
 * curve, and a polyline is what SVG wants anyway.
 *
 * WHY THE SCALE IS FIXED RATHER THAN FITTED PER PARK. This is the whole point of the screen. If each
 * park were scaled so its longest wall filled the frame, every park would draw the same size and the
 * comparison would be a lie told in geometry. Andrard's 410-foot centre and a 322-foot porch are
 * 27% apart and must LOOK 27% apart, so one scale serves all thirty-two.
 */

import type { ParkProfile } from './analytics/parkProfile';
import type { FoulGround } from './analytics/parkProfile';

/** Pixels per foot. Chosen so the deepest park still clears the top of the viewBox. */
export const PX_PER_FT = 1.2;

/** Home plate, in viewBox coordinates. The origin for every measurement below. */
export const PLATE = { x: 380, y: 600 } as const;

/**
 * The viewBox, generously padded on all sides.
 *
 * The padding is not cosmetic: the distance labels float OUTSIDE the fence, and the corner labels sit
 * furthest out of anything on the diagram, so the margin exists for the labels rather than for the
 * field.
 *
 * SIZED FOR THE OLD CEILING AND NOW OVER-PROVISIONED. This was set when the corner ceilings were
 * 400 and the worst case put a 62px label centre near x = 14, close enough to the edge to matter. The
 * caps are now LF 362 / RF 355, which moves the worst-case label centre out to x = 54 and leaves
 * roughly 83px of unused margin on each side.
 *
 * It is left oversized deliberately. The binding constraint on this box is now the ROOF, not the
 * labels: a roofed park pushes its outer arc out to `fence + 86px`, which at the old 400-foot corner
 * reached x = -61 and x = 814 -- outside this box on both sides. No park currently combines a roof
 * with a deep corner, so nothing is clipped today, but tightening the box to the new label extents
 * would clip the first roofed park that does. If this is ever resized, re-check the roof arc, not
 * the labels.
 */
export const FIELD_VIEWBOX = '-60 20 860 640';

/** Bases, in feet from the plate along each base line. Real baseball, not an approximation. */
const BASE_PATH_FT = 90;
const SECOND_BASE_FT = BASE_PATH_FT * Math.SQRT2;

const deg = (d: number): number => (d * Math.PI) / 180;

/** The five control points, in the order they appear along the arc. */
export interface FenceControl {
  /** Field label, LF / LCF / CF / RCF / RF. */
  tag: string;
  /** Degrees from dead centre; negative is left field. */
  bearingDeg: number;
  /** Distance to the wall, in feet. */
  ft: number;
  /** True for the three entered distances; false for the two interpolated ones. */
  measured: boolean;
}

/**
 * The five control points for a park.
 *
 * `measured` is carried rather than recomputed at the point of use because the honest footnote about
 * LCF and RCF has to be true of the diagram, and a flag that is derived where it is needed is a flag
 * that eventually disagrees with itself.
 */
export const fenceControls = (profile: ParkProfile): FenceControl[] => [
  { tag: 'LF', bearingDeg: -45, ft: profile.lfFt, measured: true },
  { tag: 'LCF', bearingDeg: -22.5, ft: profile.lcfFt, measured: false },
  { tag: 'CF', bearingDeg: 0, ft: profile.cfFt, measured: true },
  { tag: 'RCF', bearingDeg: 22.5, ft: profile.rcfFt, measured: false },
  { tag: 'RF', bearingDeg: 45, ft: profile.rfFt, measured: true },
];

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * The fence's distance from home plate at any bearing.
 *
 * Held flat outside the foul lines rather than extrapolated: past 45 degrees the fence is the corner
 * wall running down the line, and letting the curve continue past it would draw a park with a fifth
 * control point nobody entered.
 */
export const fenceRadiusFt = (controls: FenceControl[], bearingDeg: number): number => {
  if (bearingDeg <= controls[0].bearingDeg) return controls[0].ft;
  const last = controls[controls.length - 1];
  if (bearingDeg >= last.bearingDeg) return last.ft;

  for (let i = 0; i < controls.length - 1; i += 1) {
    const a = controls[i];
    const b = controls[i + 1];
    if (bearingDeg >= a.bearingDeg && bearingDeg <= b.bearingDeg) {
      const t = (bearingDeg - a.bearingDeg) / (b.bearingDeg - a.bearingDeg);
      return a.ft + (b.ft - a.ft) * smoothstep(t);
    }
  }
  return controls[Math.floor(controls.length / 2)].ft;
};

/** A point at `ft` from the plate on `bearingDeg`. */
export const polar = (
  ft: number,
  bearingDeg: number,
): { x: number; y: number } => {
  const r = ft * PX_PER_FT;
  const b = deg(bearingDeg);
  return { x: PLATE.x + r * Math.sin(b), y: PLATE.y - r * Math.cos(b) };
};

/** The fence arc, sampled every 3 degrees, as points. The single source for both the stroke and the fill. */
export const fencePoints = (controls: FenceControl[]): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  for (let bearing = -45; bearing <= 45; bearing += 3) {
    out.push(polar(fenceRadiusFt(controls, bearing), bearing));
  }
  return out;
};

/** The fence arc as an SVG polyline `points` string. */
export const fencePolyline = (controls: FenceControl[]): string =>
  fencePoints(controls).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** A point list as an SVG `points` string, for the fills that trace the same curve. */
export const toPointsAttr = (points: { x: number; y: number }[]): string =>
  points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** The four bases, as SVG points. */
export const diamond = (): { first: [number, number]; second: [number, number]; third: [number, number] } => {
  const first = polar(BASE_PATH_FT, 45);
  const third = polar(BASE_PATH_FT, -45);
  const second = polar(SECOND_BASE_FT, 0);
  return {
    first: [first.x, first.y],
    second: [second.x, second.y],
    third: [third.x, third.y],
  };
};

/**
 * How foul ground is SHOWN: how far past the corner line it sweeps, and how far beyond the wall.
 *
 * Generous ground is both a longer sweep and a deeper reach, so one pair of numbers carries all three
 * settings and the difference between `small` and `generous` is visible as AREA rather than having to
 * be read off a chip somewhere else on the panel.
 */
const FOUL_GROUND_SHAPE: Record<FoulGround, { sweepDeg: number; reach: number }> = {
  small: { sweepDeg: 9, reach: 1.07 },
  standard: { sweepDeg: 14, reach: 1.13 },
  generous: { sweepDeg: 20, reach: 1.21 },
};

/**
 * The foul pole: the corner itself, at the corner's own distance.
 *
 * An earlier version pushed this 5-19% further out along the SAME bearing as the corner, on the
 * theory that foul ground is distance beyond the line. Drawn, that put the pole outside the wall and
 * turned the outfield into a kite with the corners sticking past their own fence -- and the foul
 * ground wedge it was meant to show was a sliver buried under the outfield fill.
 *
 * The pole IS the corner. Foul ground is the ground beyond the pole, so it is modelled as an annular
 * sector OFF the pole, out toward the corner line and past it. That reads correctly: wall, then pole,
 * then playable-but-not field.
 */
export const foulPole = (cornerFt: number, bearingDeg: number) => polar(cornerFt, bearingDeg);

/**
 * The foul-ground wedge: an annular sector beyond the foul pole.
 *
 * `sweepDeg` is how far the ground extends past the corner, and `reach` how far beyond the wall it
 * goes. Generous ground is both a longer sweep and a deeper reach, which is why one function can
 * carry all three settings.
 */
export const foulGroundWedge = (
  cornerFt: number,
  poleBearingDeg: number,
  foulGround: FoulGround,
): { x: number; y: number }[] => {
  const { sweepDeg, reach } = FOUL_GROUND_SHAPE[foulGround];
  const sign = Math.sign(poleBearingDeg) || 1;
  const from = poleBearingDeg;
  const to = poleBearingDeg + sign * sweepDeg;
  const inner = cornerFt * 0.99;
  const outer = cornerFt * reach;

  const near: { x: number; y: number }[] = [];
  const far: { x: number; y: number }[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i += 1) {
    const bearing = from + ((to - from) * i) / steps;
    near.push(polar(inner, bearing));
    far.push(polar(outer, bearing));
  }
  // Forward along the inner arc, back along the outer, or the polygon crosses itself.
  return [...near, ...far.reverse()];
};

/**
 * Where a distance label sits, and where its leader line starts.
 *
 * The label is pushed radially outward past the fence by a fixed offset, so every label sits at the
 * same distance beyond its own wall and a shallow park reads as shallow. The anchor is the point on
 * the fence itself; the line between them is what makes the number mean a place.
 *
 * WHY NO COLLISION SOLVER. There is one, in most diagrams of this shape, and this one does not need
 * it. The tightest case the data permits is a 320-foot corner (the schema's floor) beside a 430-foot
 * centre, and those two labels are 22.5 degrees apart at radii of 410 and 542 pixels -- about 200px of
 * separation for a 62px label, so they cannot touch. The `parkDimensions` ranges make that a property
 * of the data rather than a hope about it. A relaxation pass here would be code for a collision that
 * cannot happen, which is worse than no code: it would read as handling a case that does not exist.
 */
export const LABEL_OFFSET_PX = 26;

export interface DistanceLabel {
  tag: string;
  ft: number;
  measured: boolean;
  /** Centre of the label box. */
  box: { x: number; y: number };
  /** The point on the fence the leader line terminates at. */
  anchor: { x: number; y: number };
}

export const distanceLabels = (controls: FenceControl[]): DistanceLabel[] =>
  controls.map((control) => {
    const r = control.ft * PX_PER_FT + LABEL_OFFSET_PX;
    const b = deg(control.bearingDeg);
    return {
      tag: control.tag,
      ft: control.ft,
      measured: control.measured,
      box: { x: PLATE.x + r * Math.sin(b), y: PLATE.y - r * Math.cos(b) },
      anchor: polar(control.ft, control.bearingDeg),
    };
  });

/**
 * The bar scale for the four outcome factors, and the pitcher's fatigue rate.
 *
 * MEASURED, not guessed. `tools/reportParkFactorRanges.ts` dumps the real distribution across all
 * thirty-two parks: `hrFactor` runs 0.754 to 1.238, so the furthest anything sits from neutral is
 * 0.246. A +/-0.25 scale would clip the single most extreme park in the league, so it is +/-0.30 --
 * chosen from the data with headroom, and documented here so the next person widening a bar knows
 * what has to move with it.
 */
export const FACTOR_BAR_RANGE = 0.3;

/**
 * The bar scale for pitcher fatigue, which is DIVERGING rather than neutral-centred.
 *
 * It is a multiplier on the engine's own fatigue rate and it is signed: the measured range is -0.049
 * to +0.172 across the league, meaning every park either relieves or accelerates a tired arm, and the
 * extremes are not symmetric. A bar centred at 1.000 would be meaningless here, and one drawn from a
 * single origin would hide the sign, which is the entire content of the number.
 */
export const FATIGUE_BAR_RANGE = 0.2;