import React from 'react';

type AttributePoint = {
  label: string;
  value: number;
};

interface AttributeRadarProps {
  points: AttributePoint[];
  accent?: string;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const AttributeRadar: React.FC<AttributeRadarProps> = ({
  points,
  accent = '#14d7c5',
}) => {
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
      <div className="flex justify-center">
        <svg viewBox={`0 0 ${size} ${size}`} className="h-[260px] w-[260px]" aria-label="Attribute radar chart">
          {ringPolygons.map((polygon, index) => (
            <polygon
              key={`ring-${rings[index]}`}
              points={polygon}
              fill="rgba(255,255,255,0.02)"
              stroke="rgba(255,255,255,0.08)"
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
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
          ))}

          <polygon
            points={valuePolygon}
            fill={`${accent}33`}
            stroke={accent}
            strokeWidth="2"
          />

          {axisPoints.map((point) => (
            <circle
              key={`point-${point.label}`}
              cx={point.valueX}
              cy={point.valueY}
              r="3"
              fill={accent}
            />
          ))}

          {axisPoints.map((point) => (
            <text
              key={`label-${point.label}`}
              x={point.labelX}
              y={point.labelY}
              textAnchor={point.labelX < center - 8 ? 'end' : point.labelX > center + 8 ? 'start' : 'middle'}
              dominantBaseline="middle"
              className="fill-zinc-500 text-[10px] uppercase tracking-[0.18em]"
            >
              {point.label}
            </text>
          ))}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {points.map((point) => (
          <div key={point.label} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{point.label}</p>
            <p className="mt-2 font-display text-2xl uppercase tracking-[0.08em] text-white">{point.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
