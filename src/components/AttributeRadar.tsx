import React from 'react';
import { Panel } from './ui';

type AttributePoint = {
  label: string;
  value: number;
};

interface AttributeRadarProps {
  points: AttributePoint[];
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Attribute radar, chrome-framed.
 *
 * The stroke is gold unconditionally. The previous version took an `accent`
 * prop and both call sites passed a raw hex to tint pitchers teal and batters
 * gold -- which is the same mistake the design system exists to prevent, just
 * applied to a chart instead of a panel. Gold is the product's chrome colour
 * and the radar is chrome; the player's role is already carried by the axis
 * labels and the surrounding panel.
 */
export const AttributeRadar: React.FC<AttributeRadarProps> = ({ points }) => {
  const size = 260;
  const center = size / 2;
  const radius = 78;
  const minRating = 50;
  const maxRating = 100;

  const axisPoints = points.map((point, index) => {
    const angle = (-Math.PI / 2) + (Math.PI * 2 * index) / points.length;
    const normalized = clamp((point.value - minRating) / (maxRating - minRating), 0, 1);
    return {
      ...point,
      angle,
      axisX: center + Math.cos(angle) * radius,
      axisY: center + Math.sin(angle) * radius,
      valueX: center + Math.cos(angle) * radius * normalized,
      valueY: center + Math.sin(angle) * radius * normalized,
      labelX: center + Math.cos(angle) * (radius + 28),
      labelY: center + Math.sin(angle) * (radius + 28),
    };
  });

  const rings = [0.25, 0.5, 0.75, 1];
  const ringPolygons = rings.map((factor) =>
    axisPoints
      .map(({ angle }) => `${center + Math.cos(angle) * radius * factor},${center + Math.sin(angle) * radius * factor}`)
      .join(' '),
  );
  const valuePolygon = axisPoints.map(({ valueX, valueY }) => `${valueX},${valueY}`).join(' ');

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-center">
      <Panel variant="sunken" className="flex items-center justify-center p-3">
        <svg viewBox={`0 0 ${size} ${size}`} className="h-[248px] w-[248px]" role="img" aria-label="Attribute radar chart">
          {ringPolygons.map((polygon, index) => (
            <polygon
              key={`ring-${rings[index]}`}
              points={polygon}
              fill="var(--color-panel-2)"
              stroke="var(--color-chrome-lo)"
              strokeWidth="1"
            />
          ))}

          {axisPoints.map((point) => (
            <line
              key={`axis-${point.label}`}
              x1={center}
              y1={center}
              x2={point.axisX}
              y2={point.axisY}
              stroke="var(--color-chrome-lo)"
              strokeWidth="1"
            />
          ))}

          <polygon
            points={valuePolygon}
            fill="var(--color-gold)"
            fillOpacity="0.18"
            stroke="var(--color-gold)"
            strokeWidth="2"
          />

          {axisPoints.map((point) => (
            <circle
              key={`point-${point.label}`}
              cx={point.valueX}
              cy={point.valueY}
              r="3"
              fill="var(--color-gold)"
            />
          ))}

          {axisPoints.map((point) => (
            <text
              key={`label-${point.label}`}
              x={point.labelX}
              y={point.labelY}
              textAnchor={point.labelX < center - 8 ? 'end' : point.labelX > center + 8 ? 'start' : 'middle'}
              dominantBaseline="middle"
              className="fill-[var(--color-ink-faint)] t-caption"
            >
              {point.label}
            </text>
          ))}
        </svg>
      </Panel>

      <div className="grid grid-cols-2 gap-2">
        {points.map((point) => (
          <div key={point.label} className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
            <p className="t-caption text-[var(--color-ink-faint)]">{point.label}</p>
            <p className="t-stat-lg mt-1 text-[var(--color-ink)]">{point.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
