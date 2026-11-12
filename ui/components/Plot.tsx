import { useMemo } from 'react';
import { readPlot, samplePlot, tickLabel } from '../../backend/core/plot';
import type { SampledPlot } from '../../backend/core/plot';
import './Diagram.css';

const W = 560;
const H = 320;
const M = { top: 14, right: 18, bottom: 44, left: 52 };
const COLOURS = ['var(--plot-1)', 'var(--plot-2)', 'var(--plot-3)', 'var(--plot-4)'];

/** A plot from a fenced `plot` block (design §4.2, "Diagrams and plots"): curves, data and marked points. */
export function Plot({ source }: { source: string }) {
  const read = useMemo(() => readPlot(source), [source]);
  const plot = useMemo(() => (read.ok ? samplePlot(read.spec) : null), [read]);
  if (!plot) return <DrawingFailed source={source} what="plot" />;
  return <PlotView plot={plot} />;
}

function PlotView({ plot }: { plot: SampledPlot }) {
  const sx = (x: number) => M.left + ((x - plot.x.min) / (plot.x.max - plot.x.min)) * (W - M.left - M.right);
  const sy = (y: number) => H - M.bottom - ((y - plot.y.min) / (plot.y.max - plot.y.min)) * (H - M.top - M.bottom);
  const path = (points: ([number, number] | null)[]) => {
    let d = '';
    let pen = false;
    for (const p of points) {
      if (!p) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const labelled = plot.lines.some((l) => l.label);
  const description = [plot.title, ...plot.lines.map((l) => l.label).filter(Boolean), ...plot.points.map((p) => p.label).filter(Boolean)].filter(Boolean).join(', ');
  return (
    <figure className="drawing">
      {plot.title && <figcaption className="drawing-title">{plot.title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description || 'A plot'} className="plot">
        {plot.y.ticks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} className={t === 0 ? 'plot-zero' : 'plot-grid'} />
            <text x={M.left - 8} y={sy(t)} className="plot-tick" textAnchor="end" dominantBaseline="middle">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {plot.x.ticks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={M.top} y2={H - M.bottom} className={t === 0 ? 'plot-zero' : 'plot-grid'} />
            <text x={sx(t)} y={H - M.bottom + 16} className="plot-tick" textAnchor="middle">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {plot.x.label && (
          <text x={(M.left + W - M.right) / 2} y={H - 6} className="plot-axis-label" textAnchor="middle">
            {plot.x.label}
          </text>
        )}
        {plot.y.label && (
          <text transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} className="plot-axis-label" textAnchor="middle">
            {plot.y.label}
          </text>
        )}
        {plot.lines.map((line, i) => (
          <path key={i} d={path(line.points)} className="plot-line" style={{ stroke: COLOURS[i % COLOURS.length] }} />
        ))}
        {plot.points.map((p, i) => (
          <g key={`p${i}`}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={4.5} className="plot-point" />
            {p.label && (
              <text x={sx(p.x) + (sx(p.x) > W * 0.7 ? -9 : 9)} y={sy(p.y) - 9} className="plot-point-label" textAnchor={sx(p.x) > W * 0.7 ? 'end' : 'start'}>
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {labelled && (
        <ul className="plot-legend" aria-label="Lines">
          {plot.lines.map((line, i) =>
            line.label ? (
              <li key={i}>
                <span className="plot-swatch" style={{ background: COLOURS[i % COLOURS.length] }} aria-hidden="true" />
                {line.label}
              </li>
            ) : null,
          )}
        </ul>
      )}
    </figure>
  );
}

/** A drawing that cannot be drawn shows what was written, so nothing is lost. */
export function DrawingFailed({ source, what }: { source: string; what: 'plot' | 'diagram' }) {
  return (
    <figure className="drawing is-failed">
      <figcaption className="t-caption text-muted">This {what} could not be drawn; here is how it was written.</figcaption>
      <pre className="drawing-source">
        <code>{source}</code>
      </pre>
    </figure>
  );
}
