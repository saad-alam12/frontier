import type { FrontierMap, FrontierState } from '../../backend/api/contract';
import { Markdown } from './Markdown';
import { useLayoutEffect, useRef, useState } from 'react';
import { cubicPath, layoutFrontier } from '../lib/frontierLayout';

const STATE_WORD: Record<FrontierState, string> = { owned: 'Yours', current: 'Learning now', learnable: 'Learnable now', beyond: 'Beyond your edge' };

/** "Your frontier": the ideas around the current one, the edge of knowledge, and why this idea now. */
export function FrontierPanel({ map, why, onSelect }: { map: FrontierMap; why: string; onSelect?: (nodeId: string) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(440);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width) || 440);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const layout = layoutFrontier(map, width);
  const currentId = map.nodes.find((n) => n.state === 'current')?.id;
  const describe = (['current', 'owned', 'learnable', 'beyond'] as FrontierState[])
    .map((state) => {
      const names = layout.nodes.filter((p) => p.state === state).map((p) => plain(p.name));
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

      <div ref={boxRef} className="frontier-map" style={{ height: layout.height }} role="img" aria-label={`Map of the ideas around this one. ${describe}`}>
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
          <g fill="none" strokeWidth="1">
            {layout.links.map((l) => {
              const touchesCurrent = l.from === currentId || l.to === currentId;
              return <path key={`${l.from}>${l.to}`} d={l.path} stroke={touchesCurrent ? 'var(--accent)' : 'var(--node-muted)'} strokeOpacity={touchesCurrent ? 0.42 : 0.55} />;
            })}
          </g>
          <path d={cubicPath(layout.edgeLine)} fill="none" stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="4 6" />
        </svg>
        {layout.nodes.map((p) => (
          <span key={p.id} className={`map-node is-${p.state}`} style={{ left: p.x, top: p.y }} aria-hidden="true" />
        ))}
        {layout.nodes.map((p) => {
          const style = { left: p.label.x, top: p.label.y, width: p.label.width, height: p.label.height, justifyContent: p.label.align === 'right' ? 'flex-end' : 'flex-start' };
          const className = `map-label is-${p.state}`;
          const text = (
            <span className="map-label-text" style={{ textAlign: p.label.align }}>
              <Markdown text={p.name} inline />
            </span>
          );
          return onSelect ? (
            <button key={p.id} type="button" className={className} style={style} title={plain(p.name)} onClick={() => onSelect(p.id)}>
              {text}
            </button>
          ) : (
            <span key={p.id} className={className} style={style} title={plain(p.name)}>
              {text}
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
