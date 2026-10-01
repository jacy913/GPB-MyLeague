import React, { useMemo, useState } from 'react';

/**
 * A two-variable scatter, with the league's means drawn on it.
 *
 * WHY THIS IS THE SCREEN AND NOT ANOTHER LIST. Every board on the tables side answers
 * one question about one variable, and the question a reader actually has is comparative:
 * "who gets on base AND who hits for power". That is a two-variable question and a
 * one-column table structurally cannot express it. This is the first thing on the
 * dashboard that can.
 *
 * The crosshairs are the point, not the dots. A dot at (.340, .190) means nothing on its
 * own; the same dot against the league's mean OBP and mean SLG is immediately readable as
 * a power hitter who does not get on base, which is a sentence you could not write from
 * any table on this screen.
 *
 * ---------------------------------------------------------------------------
 * THE AXES DO NOT START AT ZERO, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 *
 * Batting averages sit between roughly .180 and .380. Drawn from zero, every player
 * would be a dot in the top sixth of the box and the shape would be a smear. Drawn from
 * zero it is also the honest-looking choice, which is what makes it wrong here: it
 * exaggerates the differences that the crosshairs already show, and the reader cannot
 * tell which exaggeration they are looking at.
 *
 * So the axes run over the OBSERVED range with a little padding, and both ends are
 * labelled with their values. A reader who needs to know the scale can read it off the
 * axis; a reader scanning for shape does not have to think about it. Zero-based would
 * have been simpler and would have hidden the only thing this plot is for.
 *
 * Dot AREA encodes plate appearances or innings, because a September call-up's dot should
 * not sit in the same visual weight as a starter's. Area rather than radius, so doubling
 * the playing time does not quadruple the visual weight of the dot.
 *
 * It is NOT proportional to playing time, and an earlier draft of this comment claimed it
 * was. A floor keeps every dot visible and clickable -- a genuinely zero-weight player
 * would otherwise render as nothing at all, and a two-pixel target is not a control --
 * and a floor makes the mapping non-linear: with the constants below, a 600-PA player and
 * a 300-PA player get areas of 3.50 and 2.20, which is 1.6x rather than 2x. The property
 * that actually holds, and the one the eye relies on, is monotonicity plus a bounded
 * ratio: playing time moves a dot in one direction and cannot make it arbitrarily larger
 * than anybody else's.
 */

export interface QuadrantPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Playing time. Encodes dot area, so a call-up is visibly smaller than a starter. */
  weight: number;
  /** Shown in the readout when the point is selected. */
  detail?: string;
  teamId?: string | null;
}

export interface QuadrantDefinition {
  /** Which side of the vertical mean line this quadrant sits on. */
  xAbove: boolean;
  /** Which side of the horizontal mean line. */
  yAbove: boolean;
  name: string;
  note: string;
}

export interface QuadrantPlotProps {
  title: string;
  xLabel: string;
  yLabel: string;
  points: readonly QuadrantPoint[];
  meanX: number;
  meanY: number;
  quadrants: readonly QuadrantDefinition[];
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  className?: string;
}

/** Viewbox units. The SVG scales to its container; these are layout numbers. */
const W = 100;
const H = 62;
const PAD = 5;

export const QuadrantPlot: React.FC<QuadrantPlotProps> = ({
  title,
  xLabel,
  yLabel,
  points,
  meanX,
  meanY,
  quadrants,
  formatX,
  formatY,
  className = '',
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const scale = useMemo(() => {
    const usable: QuadrantPoint[] = points.filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    );
    if (usable.length === 0) {
      return { usable, toX: () => PAD, toY: () => H - PAD, x0: 0, x1: 1, y0: 0, y1: 1, maxWeight: 1 };
    }
    const xs = usable.map((p) => p.x);
    const ys = usable.map((p) => p.y);
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    // A flat axis would divide by zero and collapse every dot onto one line.
    if (x1 === x0) { x0 -= 0.5; x1 += 0.5; }
    if (y1 === y0) { y0 -= 0.5; y1 += 0.5; }
    // Padding so the extremes are not sitting on the frame itself.
    const padX = (x1 - x0) * 0.06;
    const padY = (y1 - y0) * 0.08;
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    const maxWeight = Math.max(1, ...usable.map((p) => p.weight));
    return {
      usable,
      x0,
      x1,
      y0,
      y1,
      maxWeight,
      toX: (v: number) => PAD + ((v - x0) / (x1 - x0)) * (W - PAD * 2),
      // SVG y grows downward, so the value axis is inverted here once and never again.
      toY: (v: number) => H - PAD - ((v - y0) / (y1 - y0)) * (H - PAD * 2),
    };
  }, [points]);

  const selected = scale.usable.find((p) => p.id === selectedId) ?? null;
  const meanXPos = scale.toX(meanX);
  const meanYPos = scale.toY(meanY);

  const dotArea = (weight: number): number =>
    // Area-proportional to weight, against a 0.9-unit floor so a call-up is still a dot
    // and can be clicked.
    0.9 + 2.6 * Math.max(0, weight) / scale.maxWeight;

  if (scale.usable.length === 0) {
    return (
      <div className={className}>
        <p className="t-label">{title}</p>
        <div className="mt-1 flex h-24 items-center justify-center border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)]">
          <span className="t-caption text-[var(--color-ink-faint)]">
            Not enough players clear the qualifying floor yet
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="t-label">{title}</p>

      <div className="relative mt-1 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={describe(title, xLabel, yLabel, scale.usable.length, meanX, meanY, formatX, formatY)}
        >
          {/* Quadrant washes, so the four regions read as named territory. */}
          {quadrants.map((q) => {
            const left = q.xAbove ? meanXPos : PAD;
            const right = q.xAbove ? W - PAD : meanXPos;
            const top = q.yAbove ? PAD : meanYPos;
            const bottom = q.yAbove ? meanYPos : H - PAD;
            return (
              <rect
                key={`${q.name}-w`}
                x={left}
                y={top}
                width={Math.max(0, right - left)}
                height={Math.max(0, bottom - top)}
                fill="var(--color-panel)"
                opacity={selected && quadrantOf(selected, meanX, meanY, quadrants)?.name === q.name ? 1 : 0.5}
              />
            );
          })}

          {/* Crosshairs at the league means. */}
          <line x1={meanXPos} y1={PAD} x2={meanXPos} y2={H - PAD} stroke="var(--color-gold)" strokeWidth={0.35} />
          <line x1={PAD} y1={meanYPos} x2={W - PAD} y2={meanYPos} stroke="var(--color-gold)" strokeWidth={0.35} />

          {/* Quadrant names, set small and faint so they annotate rather than compete. */}
          {quadrants.map((q) => {
            const left = q.xAbove ? meanXPos : PAD;
            const right = q.xAbove ? W - PAD : meanXPos;
            const top = q.yAbove ? PAD : meanYPos;
            const bottom = q.yAbove ? meanYPos : H - PAD;
            return (
              <text
                key={`${q.name}-t`}
                x={q.xAbove ? left + 1.5 : right - 1.5}
                y={q.yAbove ? top + 4 : bottom - 1.5}
                textAnchor={q.xAbove ? 'start' : 'end'}
                className="t-caption"
                fill="var(--color-ink-faint)"
                style={{ fontSize: 2.4 }}
              >
                {q.name}
              </text>
            );
          })}

          {scale.usable.map((point) => {
            const isSelected = point.id === selectedId;
            const r = Math.sqrt(dotArea(point.weight) / Math.PI);
            return (
              <circle
                key={point.id}
                cx={scale.toX(point.x)}
                cy={scale.toY(point.y)}
                r={isSelected ? r * 1.5 : r}
                fill={isSelected ? 'var(--color-gold)' : 'var(--color-ink-dim)'}
                fillOpacity={isSelected ? 1 : 0.75}
                // A larger invisible hit target than the visible dot, because the
                // visible dot is as small as two or three pixels and a two-pixel
                // target is not a control.
                stroke={isSelected ? 'var(--color-gold-hi)' : 'transparent'}
                strokeWidth={0.4}
                onClick={() => setSelectedId(isSelected ? null : point.id)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}
        </svg>
      </div>

      {/* Axis ends, labelled. The scale is not zero-based, so it has to be stated. */}
      <div className="mt-1 flex justify-between t-caption tabular-nums text-[var(--color-ink-faint)]">
        <span>{formatX(scale.x0)}</span>
        <span>{xLabel}</span>
        <span>{formatX(scale.x1)}</span>
      </div>

      <p className="mt-0.5 flex items-baseline justify-between gap-2 t-caption text-[var(--color-ink-faint)]">
        <span>{yLabel}</span>
        <span className="tabular-nums">{formatY(scale.y1)} &ndash; {formatY(scale.y0)}</span>
      </p>

      {/*
        THE READOUT.

        A click selects rather than navigates, and that is a deliberate limit rather than
        an unfinished one: this app has team pages but NO player page, so a clickable dot
        promising to open a player's card would be a dead end. The `nameCell` button on
        the tables side is the same story -- it has had no `onClick` for the same reason.

        Showing the selected player's two figures, their distance from each mean, and
        their quadrant answers everything the dot promised. Opening a player page is a
        separate piece of work and would be a lie to imply it exists.
      */}
      {selected ? (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 t-caption">
          <span className="font-semibold text-[var(--color-gold-hi)]">{selected.label}</span>
          <span className="tabular-nums">
            {xLabel} {formatX(selected.x)} · {yLabel} {formatY(selected.y)}
          </span>
          <span className="text-[var(--color-ink-faint)]">
            {quadrantOf(selected, meanX, meanY, quadrants)?.name ?? ''}
          </span>
          {selected.detail && <span className="text-[var(--color-ink-faint)]">{selected.detail}</span>}
        </p>
      ) : (
        <p className="mt-1 t-caption text-[var(--color-ink-faint)]">
          {scale.usable.length} players. Gold lines are the league means; dot size is playing
          time. Click a dot for a readout.
        </p>
      )}
    </div>
  );
};

/** Which named quadrant a point falls in, under whichever axis is larger. */
const quadrantOf = (
  point: QuadrantPoint,
  meanX: number,
  meanY: number,
  quadrants: readonly QuadrantDefinition[],
): QuadrantDefinition | null => {
  const xAbove = point.x >= meanX;
  const yAbove = point.y >= meanY;
  return quadrants.find((q) => q.xAbove === xAbove && q.yAbove === yAbove) ?? null;
};

const describe = (
  title: string,
  xLabel: string,
  yLabel: string,
  count: number,
  meanX: number,
  meanY: number,
  formatX: (v: number) => string,
  formatY: (v: number) => string,
): string =>
  `${title}. Scatter of ${count} players, ${xLabel} horizontally and ${yLabel} vertically. `
  + `League means are ${formatX(meanX)} and ${formatY(meanY)}. `
  + `A full reading of any individual point is available by selecting it, which the table below the plot reports.`;