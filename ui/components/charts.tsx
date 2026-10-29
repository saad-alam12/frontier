import { useState } from 'react';
import { useTip } from './tooltip';

/**
 * Small SVG charts for Stats, drawn to the Atlas tokens: thin marks, rounded data ends on the
 * baseline, recessive axes, a hover tooltip on every mark, a legend for two or more series. Series
 * colours follow the entity (a goal keeps its colour whatever the filter) and come in a fixed order
 * validated for colour-vision deficiency on the dark surface.
 */
export const SERIES = ['#7489e6', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'] as const;
export const OTHER = '#5a554c';

export function seriesColor(index: number): string {
  return index >= 0 && index < SERIES.length ? (SERIES[index] as string) : OTHER;
}

/** A bar with 4 px rounded data end, square on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={i.dashed ? 'legend-line is-dashed' : 'legend-swatch'} style={i.dashed ? { borderColor: i.color } : { background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Minutes per week, stacked by goal, with the weekly rhythm the budgets ask for as a dashed line. */
export function WeeklyBars({ weeks, series, format }: { weeks: { start: string; minutes: Record<string, number>; target: number | null }[]; series: { id: string; label: string; color: string }[]; format: (m: number) => string }) {
  const { ref, show, hide, layer, width: W } = useTip();
  const H = 180;
  const pad = { l: 36, r: 8, t: 10, b: 22 };
  const totals = weeks.map((w) => Object.values(w.minutes).reduce((a, b) => a + b, 0));
  const target = weeks.find((w) => w.target)?.target ?? null;
  const max = Math.max(60, ...totals, target ?? 0) * 1.1;
  const step = (W - pad.l - pad.r) / weeks.length;
  const bw = Math.min(28, step * 0.62);
  const y = (m: number) => pad.t + (H - pad.t - pad.b) * (1 - m / max);
  const ticks = niceTicks(max);
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Minutes studied per week">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 3} className="axis" textAnchor="end">
              {t >= 60 ? `${Math.round(t / 60)}h` : `${t}m`}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const x = pad.l + i * step + (step - bw) / 2;
          let base = 0;
          const order = series.filter((s) => (w.minutes[s.id] ?? 0) > 0);
          return (
            <g key={w.start} onPointerMove={(e) => show(e, <WeekTip week={w} series={series} format={format} />)} onPointerLeave={hide}>
              <rect x={pad.l + i * step} y={pad.t} width={step} height={H - pad.t - pad.b} fill="transparent" />
              {order.map((s, j) => {
                const m = w.minutes[s.id] ?? 0;
                const top = y(base + m);
                const h = y(base) - top - (j > 0 ? 2 : 0);
                base += m;
                const last = j === order.length - 1;
                return last ? <path key={s.id} d={barPath(x, top, bw, Math.max(0, h))} fill={s.color} /> : <rect key={s.id} x={x} y={top} width={bw} height={Math.max(0, h)} fill={s.color} />;
              })}
              {i % Math.ceil(weeks.length / 8) === 0 && (
                <text x={x + bw / 2} y={H - 6} className="axis" textAnchor="middle">
                  {shortDate(w.start)}
                </text>
              )}
            </g>
          );
        })}
        {target && <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} className="target-line" />}
      </svg>
      {layer}
      <Legend items={[...series.map((s) => ({ label: s.label, color: s.color })), ...(target ? [{ label: `Your goals ask ${format(target)} a week`, color: 'var(--text-secondary)', dashed: true }] : [])]} />
    </div>
  );
}

function WeekTip({ week, series, format }: { week: { start: string; minutes: Record<string, number>; target: number | null }; series: { id: string; label: string; color: string }[]; format: (m: number) => string }) {
  const total = Object.values(week.minutes).reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="tip-title">Week of {shortDate(week.start)}</div>
      {series
        .filter((s) => week.minutes[s.id])
        .map((s) => (
          <div key={s.id} className="tip-row">
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{format(week.minutes[s.id] ?? 0)}</b>
          </div>
        ))}
      <div className="tip-row is-total">
        <span>Total</span>
        <b>{format(total)}</b>
      </div>
    </>
  );
}

/** Twelve weeks of days, Monday on top; brighter is more time. */
export function Calendar({ days, format }: { days: { date: string; minutes: number }[]; format: (m: number) => string }) {
  const { ref, show, hide, layer } = useTip();
  const cell = 14;
  const gap = 3;
  const weeks = Math.ceil(days.length / 7);
  const max = Math.max(30, ...days.map((d) => d.minutes));
  const today = localToday();
  const level = (m: number) => (m <= 0 ? 0 : m < max * 0.25 ? 1 : m < max * 0.5 ? 2 : m < max * 0.75 ? 3 : 4);
  const width = weeks * (cell + gap) + 24;
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={7 * (cell + gap) + 4} viewBox={`0 0 ${width} ${7 * (cell + gap) + 4}`} role="img" aria-label="Time studied per day over twelve weeks" className="calendar">
        {['M', '', 'W', '', 'F', '', ''].map((l, i) => (
          <text key={i} x={0} y={i * (cell + gap) + cell - 3} className="axis">
            {l}
          </text>
        ))}
        {days.map((d, i) => {
          const col = Math.floor(i / 7);
          const row = i % 7;
          const future = d.date > today;
          return (
            <rect
              key={d.date}
              x={24 + col * (cell + gap)}
              y={row * (cell + gap)}
              width={cell}
              height={cell}
              rx={3}
              className={future ? 'cal-cell is-future' : `cal-cell is-l${level(d.minutes)}${d.date === today ? ' is-today' : ''}`}
              onPointerMove={(e) => !future && show(e, <><div className="tip-title">{longDate(d.date)}</div><div>{d.minutes ? format(d.minutes) : 'No study'}</div></>)}
              onPointerLeave={hide}
            />
          );
        })}
      </svg>
      {layer}
      <div className="chart-legend">
        <span className="text-muted">Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`cal-key is-l${l}`} />
        ))}
        <span className="text-muted">More</span>
      </div>
    </div>
  );
}

/** Lines over time, each directly labelled at its end; a crosshair reads every series at once. */
export function Lines({ points, series, yFormat, xLabel, height = 180, yMax, area }: { points: { x: string; values: number[] }[]; series: { label: string; color: string }[]; yFormat: (v: number) => string; xLabel: (x: string) => string; height?: number; yMax?: number; area?: boolean }) {
  const { ref, show, hide, layer, width: W } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const pad = { l: 40, r: 96, t: 12, b: 22 };
  const max = yMax ?? Math.max(1, ...points.flatMap((p) => p.values)) * 1.1;
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = niceTicks(max, yMax !== undefined);
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const rel = ((e.clientX - box.left) / box.width) * (W - pad.l - pad.r);
    const i = Math.max(0, Math.min(points.length - 1, Math.round((rel / (W - pad.l - pad.r)) * (points.length - 1))));
    setHover(i);
    const p = points[i];
    if (p)
      show(
        e,
        <>
          <div className="tip-title">{xLabel(p.x)}</div>
          {series.map((s, k) => (
            <div key={s.label} className="tip-row">
              <i style={{ background: s.color }} />
              <span>{s.label}</span>
              <b>{yFormat(p.values[k] ?? 0)}</b>
            </div>
          ))}
        </>,
      );
  };
  if (points.length < 2) return <p className="t-small m-0 text-muted">Not enough history yet.</p>;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 3} className="axis" textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} className="axis" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
            {xLabel(points[i]?.x ?? '')}
          </text>
        ))}
        {series.map((s, k) => {
          const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.values[k] ?? 0).toFixed(1)}`).join('');
          return (
            <g key={s.label}>
              {area && <path d={`${d}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={s.color} opacity={0.12} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {labelPositions(series.map((_, k) => y(points[points.length - 1]?.values[k] ?? 0))).map((ly, k) => (
          <text key={series[k]?.label} x={x(points.length - 1) + 8} y={ly + 4} className="direct-label">
            {series[k]?.label}
          </text>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="crosshair" />
            {series.map((s, k) => (
              <circle key={s.label} cx={x(hover)} cy={y(points[hover]?.values[k] ?? 0)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => (setHover(null), hide())} />
      </svg>
      {layer}
    </div>
  );
}

/** Twenty-four bars, one per hour of the day. */
export function HourBars({ hours, format }: { hours: { hour: number; minutes: number; avgScore: number | null; answers: number }[]; format: (m: number) => string }) {
  const { ref, show, hide, layer, width: W } = useTip();
  const H = 140;
  const pad = { l: 8, r: 8, t: 8, b: 22 };
  const max = Math.max(10, ...hours.map((h) => h.minutes));
  const step = (W - pad.l - pad.r) / 24;
  const bw = step - 4;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Time studied by hour of the day">
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="grid" />
        {hours.map((h) => {
          const bh = ((H - pad.t - pad.b) * h.minutes) / max;
          const x = pad.l + h.hour * step + 2;
          return (
            <g
              key={h.hour}
              onPointerMove={(e) =>
                show(
                  e,
                  <>
                    <div className="tip-title">
                      {h.hour}:00–{h.hour + 1}:00
                    </div>
                    <div>{h.minutes ? format(h.minutes) : 'No study'}</div>
                    {h.answers > 0 && <div className="text-secondary">{Math.round((h.avgScore ?? 0) * 100)}% average over {h.answers} answers</div>}
                  </>,
                )
              }
              onPointerLeave={hide}
            >
              <rect x={pad.l + h.hour * step} y={pad.t} width={step} height={H - pad.t - pad.b} fill="transparent" />
              <path d={barPath(x, H - pad.b - bh, bw, bh)} fill="var(--accent)" opacity={h.minutes ? 1 : 0} />
              {h.hour % 6 === 0 && (
                <text x={x} y={H - 6} className="axis">
                  {h.hour}:00
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {layer}
    </div>
  );
}

/** How you scored at each confidence, against the confidence itself (the tick). */
export function Calibration({ rows }: { rows: { label: string; confidence: number; avgScore: number; count: number }[] }) {
  return (
    <ul className="calibration">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="cal-label">
            {r.label}
            <span className="t-caption text-muted"> · {r.count} answers</span>
          </span>
          <span className="cal-track" role="img" aria-label={`${r.label}: ${Math.round(r.avgScore * 100)}% average score`}>
            {r.count > 0 && <span className="cal-bar" style={{ width: `${r.avgScore * 100}%` }} />}
            <span className="cal-tick" style={{ left: `${r.confidence * 100}%` }} title={`Saying "${r.label.toLowerCase()}" means about ${Math.round(r.confidence * 100)}%`} />
          </span>
          <span className="cal-value">{r.count ? `${Math.round(r.avgScore * 100)}%` : '—'}</span>
        </li>
      ))}
    </ul>
  );
}

/** End labels pushed apart so lines that end together keep readable labels (14 px apart). */
function labelPositions(ys: number[]): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let j = 1; j < order.length; j += 1) {
    const prev = order[j - 1] as { y: number };
    const cur = order[j] as { y: number };
    if (cur.y - prev.y < 14) cur.y = prev.y + 14;
  }
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

function niceTicks(max: number, percent = false): number[] {
  if (percent) return [0, 0.25, 0.5, 0.75, 1].filter((t) => t <= max);
  const steps = [5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3000, 6000];
  const raw = max / 4;
  const step = steps.find((s) => s >= raw) ?? Math.ceil(raw);
  const out: number[] = [];
  for (let t = 0; t <= max; t += step) out.push(t);
  return out;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}
