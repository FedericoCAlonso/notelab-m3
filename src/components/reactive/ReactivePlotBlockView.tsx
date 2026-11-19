import React, { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { evaluatePlotBlock } from '../../engine/plot/plotEvaluator';
import { EvaluatedDocument } from '../../engine/parser/types';

interface ReactivePlotBlockViewProps {
  plotContent: string;
  evaluatedDoc: EvaluatedDocument;
}

const SERIES_COLORS = [
  'var(--md-sys-color-primary)',
  'var(--md-sys-color-tertiary)',
  'var(--md-sys-color-secondary)',
  'var(--md-sys-color-error)',
];

function formatTick(val: number): string {
  const clean = Math.abs(val) < 1e-10 ? 0 : val;
  if (Number.isInteger(clean)) return String(clean);
  if (Math.abs(clean) >= 1000) return clean.toFixed(0);
  if (Math.abs(clean) >= 10) return Number(clean.toFixed(1)).toString();
  return Number(clean.toFixed(2)).toString();
}

export const ReactivePlotBlockView: React.FC<ReactivePlotBlockViewProps> = ({
  plotContent,
  evaluatedDoc,
}) => {
  const plot = useMemo(
    () => evaluatePlotBlock(plotContent, evaluatedDoc),
    [plotContent, evaluatedDoc]
  );

  if (!plot.ok) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-error-container/75 text-on-error-container px-3 py-2 text-xs">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>Error en gráfico `plot`: {plot.error}</span>
      </div>
    );
  }

  if (plot.kind === 'bar') {
    const maxVal = Math.max(...plot.bars.map((b) => Math.abs(b.value)), 1e-6);
    const rowHeight = 32;
    const topPad = plot.title ? 34 : 14;
    const bottomPad = 24;
    const leftPad = 148;
    const rightPad = 86;
    const width = 580;
    const barAreaWidth = width - leftPad - rightPad;
    const height = topPad + plot.bars.length * rowHeight + bottomPad;

    return (
      <div className="reactive-svg-block break-inside-avoid my-2 p-3 rounded-2xl border border-outline-variant/50 bg-surface-container-lowest/90 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full max-w-[640px] h-auto mx-auto block"
          role="img"
          aria-label={plot.title ?? 'Gráfico de barras reactivo'}
        >
          {plot.title && (
            <text
              x={width / 2}
              y={20}
              textAnchor="middle"
              fill="var(--md-sys-color-on-surface)"
              fontSize="13.5"
              fontWeight="600"
            >
              {plot.title}
            </text>
          )}

          {/* Subtle vertical gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const x = leftPad + frac * barAreaWidth;
            return (
              <g key={frac}>
                <line
                  x1={x}
                  y1={topPad - 4}
                  x2={x}
                  y2={height - bottomPad}
                  stroke="var(--md-sys-color-outline-variant)"
                  strokeOpacity="0.45"
                  strokeDasharray={frac === 0 ? undefined : '3 3'}
                />
                <text
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  fill="var(--md-sys-color-on-surface-variant)"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                >
                  {formatTick(maxVal * frac)}
                </text>
              </g>
            );
          })}

          {plot.bars.map((bar, idx) => {
            const y = topPad + idx * rowHeight;
            const barW = Math.max(2, (Math.abs(bar.value) / maxVal) * barAreaWidth);
            const labelShort =
              bar.label.length > 20 ? `${bar.label.slice(0, 19)}…` : bar.label;
            return (
              <g key={`${bar.label}-${idx}`}>
                <text
                  x={leftPad - 8}
                  y={y + rowHeight / 2 + 4}
                  textAnchor="end"
                  fill="var(--md-sys-color-on-surface)"
                  fontSize="11.5"
                >
                  {labelShort}
                </text>
                <rect
                  x={leftPad}
                  y={y + 6}
                  width={barW}
                  height={rowHeight - 12}
                  rx={5}
                  fill="var(--md-sys-color-primary)"
                  fillOpacity="0.88"
                />
                <text
                  x={leftPad + barW + 6}
                  y={y + rowHeight / 2 + 4}
                  textAnchor="start"
                  fill="var(--md-sys-color-on-surface)"
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                  fontWeight="500"
                >
                  {bar.formattedValue}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  // Line / function chart
  const width = 580;
  const height = 270;
  const padLeft = 56;
  const padRight = 22;
  const padTop = plot.title ? 34 : 16;
  const padBottom = 40;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const yRange = plot.yMax - plot.yMin;
  const yPad = yRange * 0.08;
  const yLo = plot.yMin - yPad;
  const yHi = plot.yMax + yPad;

  const mapX = (x: number) =>
    padLeft + ((x - plot.xMin) / (plot.xMax - plot.xMin)) * innerW;
  const mapY = (y: number) =>
    padTop + innerH - ((y - yLo) / (yHi - yLo)) * innerH;

  const tickFracs = [0, 0.25, 0.5, 0.75, 1];
  const zeroYInBounds = yLo <= 0 && yHi >= 0;
  const zeroXInBounds = plot.xMin <= 0 && plot.xMax >= 0;

  return (
    <div className="reactive-svg-block break-inside-avoid my-2 p-3 rounded-2xl border border-outline-variant/50 bg-surface-container-lowest/90 overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-w-[640px] h-auto mx-auto block"
        role="img"
        aria-label={plot.title ?? 'Gráfico matemático reactivo'}
      >
        {plot.title && (
          <text
            x={width / 2}
            y={20}
            textAnchor="middle"
            fill="var(--md-sys-color-on-surface)"
            fontSize="13.5"
            fontWeight="600"
          >
            {plot.title}
          </text>
        )}

        {/* Gridlines & Ticks */}
        {tickFracs.map((f) => {
          const xVal = plot.xMin + (plot.xMax - plot.xMin) * f;
          const xPx = mapX(xVal);
          const yVal = yLo + (yHi - yLo) * f;
          const yPx = mapY(yVal);

          return (
            <g key={f}>
              <line
                x1={xPx}
                y1={padTop}
                x2={xPx}
                y2={padTop + innerH}
                stroke="var(--md-sys-color-outline-variant)"
                strokeOpacity="0.4"
                strokeDasharray="3 3"
              />
              <text
                x={xPx}
                y={padTop + innerH + 15}
                textAnchor="middle"
                fill="var(--md-sys-color-on-surface-variant)"
                fontSize="10"
                fontFamily="var(--font-mono)"
              >
                {formatTick(xVal)}
              </text>

              <line
                x1={padLeft}
                y1={yPx}
                x2={padLeft + innerW}
                y2={yPx}
                stroke="var(--md-sys-color-outline-variant)"
                strokeOpacity="0.4"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 7}
                y={yPx + 3.5}
                textAnchor="end"
                fill="var(--md-sys-color-on-surface-variant)"
                fontSize="10"
                fontFamily="var(--font-mono)"
              >
                {formatTick(yVal)}
              </text>
            </g>
          );
        })}

        {/* Plot border */}
        <rect
          x={padLeft}
          y={padTop}
          width={innerW}
          height={innerH}
          fill="none"
          stroke="var(--md-sys-color-outline-variant)"
          strokeWidth="1"
        />

        {/* Zero reference axes */}
        {zeroYInBounds && (
          <line
            x1={padLeft}
            y1={mapY(0)}
            x2={padLeft + innerW}
            y2={mapY(0)}
            stroke="var(--md-sys-color-on-surface-variant)"
            strokeOpacity="0.55"
            strokeWidth="1.1"
          />
        )}
        {zeroXInBounds && (
          <line
            x1={mapX(0)}
            y1={padTop}
            x2={mapX(0)}
            y2={padTop + innerH}
            stroke="var(--md-sys-color-on-surface-variant)"
            strokeOpacity="0.55"
            strokeWidth="1.1"
          />
        )}

        {/* Curves */}
        {plot.series.map((s, sIdx) => {
          const color = SERIES_COLORS[sIdx % SERIES_COLORS.length]!;
          const d = s.points
            .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${mapX(pt.x).toFixed(2)},${mapY(pt.y).toFixed(2)}`)
            .join(' ');
          return (
            <path
              key={`${s.label}-${sIdx}`}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {/* Axis labels */}
        {plot.xLabel && (
          <text
            x={padLeft + innerW / 2}
            y={height - 6}
            textAnchor="middle"
            fill="var(--md-sys-color-on-surface-variant)"
            fontSize="11"
            fontWeight="500"
          >
            {plot.xLabel}
          </text>
        )}
        {plot.yLabel && (
          <text
            x={14}
            y={padTop + innerH / 2}
            textAnchor="middle"
            transform={`rotate(-90, 14, ${padTop + innerH / 2})`}
            fill="var(--md-sys-color-on-surface-variant)"
            fontSize="11"
            fontWeight="500"
          >
            {plot.yLabel}
          </text>
        )}
      </svg>

      {/* Multi-series legend */}
      {plot.series.length > 1 && (
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-3 text-[11px] text-on-surface-variant">
          {plot.series.map((s, sIdx) => (
            <span key={`${s.label}-${sIdx}`} className="inline-flex items-center gap-1.5 font-mono">
              <span
                className="w-3 h-0.5 rounded-full inline-block"
                style={{ backgroundColor: SERIES_COLORS[sIdx % SERIES_COLORS.length] }}
              />
              <span>{s.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
