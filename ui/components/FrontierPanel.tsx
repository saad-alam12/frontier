import type { FrontierMap, FrontierState } from '../../backend/api/contract';
import { Markdown } from './Markdown';
import { EDGE_PATH, MAP_HEIGHT, MAP_WIDTH, layoutFrontier } from '../lib/frontierLayout';

const STATE_WORD: Record<FrontierState, string> = { owned: 'Yours', current: 'Learning now', learnable: 'Learnable now', beyond: 'Beyond your edge' };

/** "Your frontier": the ideas around the current one, the edge of knowledge, and why this idea now. */
export function FrontierPanel({ map, why, onSelect }: { map: FrontierMap; why: string; onSelect?: (nodeId: string) => void }) {
  const placed = layoutFrontier(map);
  const pos = new Map(placed.map((p) => [p.id, p]));
  const pct = (x: number, total: number) => `${(x / total) * 100}%`;
  const describe = (['current', 'owned', 'learnable', 'beyond'] as FrontierState[])
    .map((state) => {
      const names = placed.filter((p) => p.state === state).map((p) => plain(p.name));
      return names.length ? `${STATE_WORD[state]}: ${names.join(', ')}.` : '';
    })
    .join(' ');

  return (
    <>
      <div className="section-head">
        <h2 className="t-title">Your frontier</h2>
        <span className="t-caption text-secondary">
          {map.edgeCount} {map.edgeCount === 1 ? 'idea' : 'ideas'} on your edge
        </span>
      </div>

      <div className="frontier-map" role="img" aria-label={`Map of the ideas around this one. ${describe}`}>
        <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={EDGE_PATH} fill="none" stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
          <g stroke="var(--node-muted)" strokeWidth="1">
            {map.edges.map(([a, b]) => {
              const p = pos.get(a);
              const q = pos.get(b);
              return p && q ? <line key={`${a}>${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} vectorEffect="non-scaling-stroke" /> : null;
            })}
          </g>
        </svg>
        {placed.map((p) => (
          <span key={p.id} className={`map-node is-${p.state}`} style={{ left: pct(p.x, MAP_WIDTH), top: pct(p.y, MAP_HEIGHT) }} aria-hidden="true" />
        ))}
        {placed.map((p) => {
          // labels left of the edge sit to the right of their point; labels beyond it sit above and end at it, so all stay inside the panel
          const right = p.state === 'owned' || p.state === 'current';
          const style = right
            ? { left: pct(p.x + (p.state === 'current' ? 14 : 10), MAP_WIDTH), top: pct(p.y - (p.state === 'current' ? 11 : 8), MAP_HEIGHT) }
            : { right: pct(MAP_WIDTH - p.x - 8, MAP_WIDTH), top: pct(p.y - (p.state === 'learnable' ? 26 : 22), MAP_HEIGHT), textAlign: 'right' as const };
          const className = `map-label is-${p.state}`;
          return onSelect ? (
            <button key={p.id} type="button" className={className} style={style} title={plain(p.name)} onClick={() => onSelect(p.id)}>
              <Markdown text={p.name} inline />
            </button>
          ) : (
            <span key={p.id} className={className} style={style} title={plain(p.name)}>
              <Markdown text={p.name} inline />
            </span>
          );
        })}
      </div>

      <div className="map-legend">
        <span>
          <span className="legend-dot" style={{ width: 8, height: 8, background: 'var(--text)' }} aria-hidden="true" />
          Yours
        </span>
        <span>
          <span className="legend-dot" style={{ width: 10, height: 10, border: '1.5px solid var(--accent)' }} aria-hidden="true" />
          Learnable now
        </span>
        <span>
          <span className="legend-dot" style={{ width: 7, height: 7, background: 'var(--legend-beyond)' }} aria-hidden="true" />
          Beyond your edge
        </span>
      </div>

      {why && (
        <div className="why-card">
          <div className="label">Why this now</div>
          <div className="t-lead">{why}</div>
        </div>
      )}
    </>
  );
}

/** Names in tooltips and the text alternative: math delimiters dropped. */
function plain(name: string): string {
  return name.replace(/\$/g, '');
}
