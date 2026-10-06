import React from 'react';
import type { ParkProfile } from '../../lib/analytics/parkProfile';
import type { SoilType, WallColor } from '../../lib/analytics/parkProfile';
import {
  diamond,
  distanceLabels,
  fenceControls,
  fencePoints,
  fencePolyline,
  fenceRadiusFt,
  foulGroundWedge,
  FIELD_VIEWBOX,
  infieldDirt,
  mound,
  PLATE,
  polar,
  PX_PER_FT,
  toPointsAttr,
} from '../../lib/parkGeometry';

/**
 * ============================================================================
 * THE PARK, DRAWN AS A SURVEY SHEET
 * ============================================================================
 *
 * A schematic, not a stadium. That is a deliberate choice and it is worth defending, because the
 * obvious alternative -- a semi-realistic field with grass texture and a dirt infield -- was the
 * first instinct and it would have been wrong twice over.
 *
 * It would look better as a picture and worse as an instrument. The whole premise of the floating
 * distance boxes is that this is a MEASUREMENT, and a measurement drawn on a field that is pretending
 * to be grass is a measurement with an aesthetic competing with it. The schematic has one job: show
 * the shape of this wall, to scale, and let the numbers sit on it. Grass would be decoration arguing
 * with geometry.
 *
 * It is also honest about what is known. The fence comes from three entered distances and two
 * interpolated ones; the infield is real baseball geometry but carries no data at all; the grass
 * would carry none either but would pretend to be one of the eleven entered dimensions. Drawing it
 * flat and unfurnished says "this is the part that matters" without a word.
 *
 * The scale bar along the bottom is the other half of that. One hundred feet, measured on the same
 * scale as the fence, is the thing that makes "Andrard is a big park" a comparison rather than an
 * impression.
 */

/**
 * The fence's stroke, by wall colour.
 *
 * The factor is about a ball being harder to pick out against the wall, so drawing each wall in its
 * own colour shows the reason for the factor rather than tabulating it. `glass` is rendered in the
 * app's teal, which is the only cool accent in the palette and reads as translucent without needing
 * an alpha value.
 */
const WALL_STROKE: Record<WallColor, string> = {
  light: 'var(--color-ink-dim)',
  dark: 'var(--color-chrome-mid)',
  glass: 'var(--color-neutral)',
};

const WALL_LABEL: Record<WallColor, string> = {
  light: 'pale brick',
  dark: 'dark',
  glass: 'glass',
};

/**
 * The infield dirt, coloured by SOIL rather than by a fixed brown.
 *
 * `soilType` is one of the eleven entered dimensions and it is not scenery: `parkFactors` reads it
 * as a third door into the same outcome `surface` and `grass` come through, and `damp_heavy` clay
 * killing a hop is the reason a ground-ball park suppresses scoring. So the dirt is the one place on
 * this diagram where a fill colour IS a datum, and painting all four soils the same tan would throw
 * away the park's most legible character for free.
 *
 * Four tints of one hue, separated by lightness alone so they survive a greyscale print and do not
 * introduce a palette the app does not have. Ordered wet-to-dry to match the enum's own spread.
 */
const DIRT_FILL: Record<SoilType, string> = {
  damp_heavy: '#4a3a28',
  standard_clay: '#5c4630',
  sandy_loose: '#6b5339',
  dry_hard: '#7a6042',
};

/**
 * Stroke weight from wall height.
 *
 * A 3-foot fence and a 40-foot monument are the difference between a ball clearing it for a single
 * and clearing it and the bullpen behind it, and a diagram where both are one pixel wide throws
 * that away. Linear rather than squared: 32 feet should not look like four times 8 feet, because it
 * is not.
 */
const wallStrokeWidth = (ft: number): number => 2.4 + ft * 0.17;

/**
 * The seating ring and roof, drawn OUTSIDE the fence.
 *
 * A roof is the one dimension that changes what happens to a ball that clears the wall, so it has to
 * be visible rather than tabulated -- `roofCarry` ranges to 0.910 and is the third-largest term in the
 * whole model for a park like Calukan's.
 *
 * `retractable_open` is drawn covering one side only. That is a stylisation: the roof is either over
 * the field or it is not, and a half-covered ring reads as "retracted to one side", which is both
 * what retractable roofs actually do and the honest way to say "this one is usually open".
 */
const roofBearingSpan = (kind: ParkProfile['dimensions']['roof']): [number, number] => {
  if (kind === 'open_air') return [0, 0];
  if (kind === 'retractable_open') return [-58, 8];
  return [-58, 58];
};

const roofPath = (controls: ReturnType<typeof fenceControls>, kind: ParkProfile['dimensions']['roof']): string => {
  const [from, to] = roofBearingSpan(kind);
  if (from === to) return '';
  /*
    A ring, so the inner arc is walked forwards and the outer arc backwards. Walking both the same
    way would draw a bow-tie: the two arcs would cross between the corners and the fill would come
    out as a self-intersecting polygon that some renderers fill correctly and some do not.
  */
  const inner: { x: number; y: number }[] = [];
  const outer: { x: number; y: number }[] = [];
  for (let b = from; b <= to; b += 3) {
    const r = fenceRadiusFt(controls, b);
    inner.push(polar(r + 20, b));
    outer.push(polar(r + 86, b));
  }
  return [toPointsAttr(inner), toPointsAttr(outer.reverse())].join(' ');
};

/**
 * Ribs across the roof, one every 9 degrees.
 *
 * A roof drawn as a bare band of colour is a band of colour, and at the contrast available inside a
 * dark palette the first version was indistinguishable from the apron behind it -- a fixed-roof park
 * looked open-air. The ribs are what make it read as a STRUCTURE over the field rather than a margin
 * around it, and they are the same reason a stadium roof is recognisable at a glance in a photograph.
 */
const roofRibs = (controls: ReturnType<typeof fenceControls>, kind: ParkProfile['dimensions']['roof']): string => {
  const [from, to] = roofBearingSpan(kind);
  if (from === to) return '';
  const parts: string[] = [];
  for (let b = from; b <= to; b += 9) {
    const r = fenceRadiusFt(controls, b);
    const a = polar(r + 20, b);
    const z = polar(r + 86, b);
    parts.push(`M${a.x.toFixed(1)},${a.y.toFixed(1)} L${z.x.toFixed(1)},${z.y.toFixed(1)}`);
  }
  return parts.join(' ');
};

export const ParkField: React.FC<{ profile: ParkProfile }> = ({ profile }) => {
  const controls = fenceControls(profile);
  const bases = diamond();
  const labels = distanceLabels(controls);
  const { dimensions } = profile;

  const leftCorner = polar(profile.lfFt, -45);
  const rightCorner = polar(profile.rfFt, 45);

  return (
    <svg
      viewBox={FIELD_VIEWBOX}
      className="block h-auto w-full"
      role="img"
      aria-label={[
        `${profile.parkCity ?? profile.teamId} park diagram.`,
        `Left field ${profile.lfFt} feet, left-centre ${Math.round(profile.lcfFt)}, centre ${profile.cfFt},`,
        `right-centre ${Math.round(profile.rcfFt)}, right field ${profile.rfFt}.`,
        `${dimensions.wallHeightFt} foot ${WALL_LABEL[dimensions.wallColor]} wall, ${dimensions.roof.replace(/_/g, ' ')}.`,
      ].join(' ')}
    >
      {/* The apron behind everything, so the diagram has a ground to sit on. */}
      <rect x={-60} y={20} width={860} height={640} fill="var(--color-panel-2)" />

      {/*
        THE OUTFIELD, as a flat fill rather than a texture.

        Deliberately `neutral-dim`, which is a teal at 18% alpha: enough to say "inside the wall",
        not enough to compete with the fence stroke that is the actual subject of the drawing.
      */}
      <polygon
        points={[
          `${PLATE.x},${PLATE.y}`,
          `${leftCorner.x.toFixed(1)},${leftCorner.y.toFixed(1)}`,
          toPointsAttr(fencePoints(controls)),
          `${rightCorner.x.toFixed(1)},${rightCorner.y.toFixed(1)}`,
        ].join(' ')}
        fill="var(--color-neutral-dim)"
      />

      {/*
        THE INFIELD DIRT, over the outfield fill and under every mark on the field.

        Drawn second so it sits inside the teal rather than beside it, which is what makes the arc
        read as a boundary instead of as another shape competing with the fence. The bases, the
        mound and the foul lines all go on top of it, so this is the first of the infield marks and
        the only large fill that is not the field or the wall.
      */}
      <polygon
        points={toPointsAttr(infieldDirt())}
        fill={DIRT_FILL[dimensions.soilType]}
      />

      {/*
        FOUL GROUND, drawn as a wedge hanging off each foul pole.

        It is out here rather than inside the fence, which is the whole correction from the first
        version: foul ground is not a corner of the field, it is the ground past the pole, so it
        belongs beyond the wall and it is sized by `foulGround` in both directions.
      */}
      <polygon points={toPointsAttr(foulGroundWedge(profile.lfFt, -45, dimensions.foulGround))} fill="var(--color-warn)" opacity={0.16} />
      <polygon points={toPointsAttr(foulGroundWedge(profile.rfFt, 45, dimensions.foulGround))} fill="var(--color-warn)" opacity={0.16} />

      {/*
        THE FOUL POLES, as two dots. Small, but they are what tells the eye the amber wedge is
        ATTACHED to something rather than floating beside the field, and without them the wedge reads
        as a stray flap rather than as ground.
      */}
      <g fill="var(--color-ink-dim)">
        <circle cx={leftCorner.x} cy={leftCorner.y} r={3.5} />
        <circle cx={rightCorner.x} cy={rightCorner.y} r={3.5} />
      </g>

      {/*
        The roof, over the top of the field but under the labels.

        `base-2` rather than `chrome-lo`: the two are within a couple of values of each other, which
        is why the first version's roof was invisible -- a fixed-roof park drew identically to an
        open-air one. Darker than the apron it sits on, outlined, and ribbed.
      */}
      {roofPath(controls, dimensions.roof) !== '' && (
        <>
          <polygon points={roofPath(controls, dimensions.roof)} fill="var(--color-base-2)" />
          <path
            d={roofRibs(controls, dimensions.roof)}
            stroke="var(--color-chrome-mid)"
            strokeWidth={1}
            fill="none"
          />
          <polygon
            points={roofPath(controls, dimensions.roof)}
            fill="none"
            stroke="var(--color-chrome-hi)"
            strokeWidth={1.5}
          />
        </>
      )}

      {/* The pitcher's mound, on the dirt where it belongs. */}
      <circle cx={mound().x} cy={mound().y} r={4} fill="var(--color-ink-dim)" opacity={0.55} />

      {/* Foul lines, home plate through the bases and out to the foul poles. */}
      <line x1={PLATE.x} y1={PLATE.y} x2={leftCorner.x} y2={leftCorner.y} stroke="var(--color-ink-faint)" strokeWidth={1.2} />
      <line x1={PLATE.x} y1={PLATE.y} x2={rightCorner.x} y2={rightCorner.y} stroke="var(--color-ink-faint)" strokeWidth={1.2} />

      {/* The bases and the plate, as small marks rather than modelled objects. */}
      <g fill="var(--color-ink-dim)">
        <rect x={bases.first[0] - 4} y={bases.first[1] - 4} width={8} height={8} transform={`rotate(45 ${bases.first[0]} ${bases.first[1]})`} />
        <rect x={bases.second[0] - 4} y={bases.second[1] - 4} width={8} height={8} transform={`rotate(45 ${bases.second[0]} ${bases.second[1]})`} />
        <rect x={bases.third[0] - 4} y={bases.third[1] - 4} width={8} height={8} transform={`rotate(45 ${bases.third[0]} ${bases.third[1]})`} />
        <circle cx={PLATE.x} cy={PLATE.y} r={5} />
      </g>

      {/*
        THE WALL. One polyline through the sampled curve, stroked in the wall's own colour and
        weighted by its height, and it is the only heavy stroke in the drawing.
      */}
      <polyline
        points={fencePolyline(controls)}
        fill="none"
        stroke={WALL_STROKE[dimensions.wallColor]}
        strokeWidth={wallStrokeWidth(dimensions.wallHeightFt)}
        strokeLinejoin="round"
      />

      {/*
        THE WALL HEIGHT, INSIDE the fence at dead centre.

        It was originally placed just ABOVE the fence, which put it at y≈87 while the CF distance box
        sits at y≈83 — the label was hidden behind its own neighbour and simply did not appear, in any
        park. A collision between two annotations that I had checked for between themselves and not
        against each other, which is the version of this mistake that survives a careful review.

        Inside the fence there is nothing else at that bearing: the bases are all below the plate's
        own depth and the fence is above. Measured from the fence inward rather than from the plate,
        so it tracks the park's size instead of drifting into a fixed spot as the wall comes in.
      */}
      <g>
        <rect
          x={PLATE.x - 62}
          y={PLATE.y - fenceRadiusFt(controls, 0) * PX_PER_FT + 22}
          width={124}
          height={24}
          fill="var(--color-sunken)"
          stroke="var(--color-chrome-mid)"
          strokeWidth={1}
        />
        <text
          x={PLATE.x}
          y={PLATE.y - fenceRadiusFt(controls, 0) * PX_PER_FT + 39}
          textAnchor="middle"
          fontSize={12}
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.14em' }}
          fill="var(--color-ink-dim)"
        >
          {`${dimensions.wallHeightFt} FT WALL`}
        </text>
      </g>

      {/*
        THE DISTANCE LABELS.

        Drawn leader-line-first so each box covers the outer end of its own line, which is what turns
        a stray segment into a leader. Box, tag and value are all fixed size: uniformity across the
        five is most of what makes the row read as instrumentation rather than as five annotations
        that happen to be near each other.
      */}
      {labels.map((label) => (
        <g key={label.tag}>
          <line
            x1={label.anchor.x}
            y1={label.anchor.y}
            x2={label.box.x}
            y2={label.box.y}
            stroke="var(--color-chrome-hi)"
            strokeWidth={1}
          />
          <circle cx={label.anchor.x} cy={label.anchor.y} r={2.5} fill="var(--color-chrome-hi)" />
          <rect
            x={label.box.x - 31}
            y={label.box.y - 17}
            width={62}
            height={34}
            fill="var(--color-sunken)"
            stroke="var(--color-chrome-mid)"
            strokeWidth={1}
          />
          <text
            x={label.box.x}
            y={label.box.y - 4}
            textAnchor="middle"
            fontSize={9}
            style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.14em' }}
            fill="var(--color-ink-faint)"
          >
            {label.tag}
          </text>
          <text
            x={label.box.x}
            y={label.box.y + 12}
            textAnchor="middle"
            fontSize={16}
            style={{ fontFamily: 'var(--font-num)', fontVariantNumeric: 'tabular-nums' }}
            fill="var(--color-gold-hi)"
          >
            {Math.round(label.ft)}
          </text>
        </g>
      ))}

      {/*
        THE SCALE BAR. One hundred feet on the same scale as the fence above it, which is what turns
        "this park is big" from an impression into a comparison the reader can check.
      */}
      <g>
        <line
          x1={PLATE.x - 50 * PX_PER_FT}
          y1={PLATE.y + 26}
          x2={PLATE.x + 50 * PX_PER_FT}
          y2={PLATE.y + 26}
          stroke="var(--color-ink-faint)"
          strokeWidth={1.2}
        />
        <line
          x1={PLATE.x - 50 * PX_PER_FT}
          y1={PLATE.y + 21}
          x2={PLATE.x - 50 * PX_PER_FT}
          y2={PLATE.y + 31}
          stroke="var(--color-ink-faint)"
          strokeWidth={1.2}
        />
        <line
          x1={PLATE.x + 50 * PX_PER_FT}
          y1={PLATE.y + 21}
          x2={PLATE.x + 50 * PX_PER_FT}
          y2={PLATE.y + 31}
          stroke="var(--color-ink-faint)"
          strokeWidth={1.2}
        />
        <text
          x={PLATE.x}
          y={PLATE.y + 45}
          textAnchor="middle"
          fontSize={10}
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.14em' }}
          fill="var(--color-ink-faint)"
        >
          100 FT
        </text>
      </g>
    </svg>
  );
};