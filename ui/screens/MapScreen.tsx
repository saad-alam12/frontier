import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MapView, NodeCard } from '../../backend/api/contract';
import { call, onEvent } from '../api';
import { Screen } from '../components/Shell';
import { ChoiceChips, Empty, MetaLine } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { MapCanvas, plain } from '../components/MapCanvas';
import { NodeCardView } from '../components/NodeCard';
import { layoutMap } from '../lib/mapLayout';

/** The whole knowledge map: every idea, where your edge runs, and a card for the one you pick. */
export function MapScreen({ onOpenTrail, onGoDeeper }: { onOpenTrail: (sessionId: string) => void; onGoDeeper: (goalId: string, nodeIds?: string[]) => Promise<void> }) {
  const [map, setMap] = useState<MapView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [card, setCard] = useState<NodeCard | null>(null);
  const [goalId, setGoalId] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null);

  const refresh = useCallback(async () => setMap(await call('map.view')), []);
  useEffect(() => {
    void refresh();
    const offs = [onEvent('practice.graded', () => void refresh()), onEvent('goals.changed', () => void refresh())];
    return () => offs.forEach((off) => off());
  }, [refresh]);
  useEffect(() => {
    if (!selected) {
      setCard(null);
      return;
    }
    let live = true;
    void call('map.card', { nodeId: selected }).then((c) => live && setCard(c));
    return () => {
      live = false;
    };
  }, [selected, map]);

  const layout = useMemo(() => (map ? layoutMap({ nodes: map.nodes, chains: map.chains }) : null), [map]);
  const nodes = useMemo(() => new Map((map?.nodes ?? []).map((n) => [n.id, n])), [map]);
  const { targets, scope } = useMemo(() => {
    if (!map || goalId === 'all') return { targets: null, scope: null };
    const targetSet = new Set(map.nodes.filter((n) => n.goals.includes(goalId)).map((n) => n.id));
    const into = new Map<string, string[]>();
    for (const c of map.chains) into.set(c.conclusion, [...(into.get(c.conclusion) ?? []), ...c.premises]);
    const scopeSet = new Set<string>();
    const stack = [...targetSet];
    while (stack.length) {
      const id = stack.pop() as string;
      if (scopeSet.has(id)) continue;
      scopeSet.add(id);
      stack.push(...(into.get(id) ?? []));
    }
    return { targets: targetSet, scope: scopeSet };
  }, [map, goalId]);

  const select = (id: string | null) => {
    setSelected(id);
    if (id) setFocus((f) => ({ id, seq: (f?.seq ?? 0) + 1 }));
  };
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !map) return [];
    return map.nodes.filter((n) => plain(n.name).toLowerCase().includes(q)).slice(0, 6);
  }, [query, map]);

  if (!map || !layout) return <Screen>{null}</Screen>;
  if (map.nodes.length === 0) {
    return (
      <Screen>
        <h1 className="t-display">Map</h1>
        <Empty>Your map grows as you add material in Library and learn in sessions.</Empty>
      </Screen>
    );
  }

  const fringe = map.nodes.filter((n) => n.state === 'fringe' && (!scope || scope.has(n.id)));
  const aside = card ? (
    <NodeCardView card={card} onSelect={(id) => select(id)} onTrail={onOpenTrail} onGoDeeper={onGoDeeper} />
  ) : (
    <>
      <h2 className="t-title">Your map</h2>
      <p className="m-0 text-soft">
        Ideas flow left to right, from definitions to what is built on them. Ivory ideas are yours: bigger is deeper, fainter is fading. Ringed ideas are learnable now. Small muted ones lie beyond your edge.
      </p>
      {fringe.length > 0 && (
        <div className="flex flex-col gap-[12px]">
          <div className="panel-label">Learnable now</div>
          <ul className="list-card">
            {fringe.slice(0, 10).map((n) => (
              <li key={n.id}>
                <button type="button" className="row link-row" onClick={() => select(n.id)}>
                  <Markdown text={n.name} inline />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  return (
    <Screen aside={aside} asideLabel={card ? 'Idea' : 'Your map'} asideNarrow>
      <div className="map-head">
        <div className="flex flex-col gap-[10px]">
          <h1 className="t-display">Map</h1>
          <MetaLine small items={[`${map.counts.owned} yours`, `${map.counts.fringe} learnable now`, `${map.counts.beyond} beyond your edge`, `${map.chains.length} chains`]} />
        </div>
        <div className="map-search">
          <input
            className="input"
            aria-label="Find an idea"
            placeholder="Find an idea"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) {
                select(matches[0].id);
                setQuery('');
              }
              if (e.key === 'Escape') setQuery('');
            }}
          />
          {matches.length > 0 && (
            <ul className="list-card map-matches">
              {matches.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="row link-row"
                    onClick={() => {
                      select(n.id);
                      setQuery('');
                    }}
                  >
                    <Markdown text={n.name} inline />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {map.goals.length > 0 && (
        <ChoiceChips small label="Show a goal" value={goalId} onChange={setGoalId} options={[{ value: 'all', label: 'Everything' }, ...map.goals.map((g) => ({ value: g.id, label: g.title }))]} />
      )}
      <div className="map-stage">
        <MapCanvas layout={layout} nodes={nodes} selectedId={selected} goalTargets={targets} goalScope={scope} focus={focus} onSelect={select} />
      </div>
      <div className="map-legend">
        <span>
          <span className="legend-dot" style={{ width: 9, height: 9, background: 'var(--text)' }} aria-hidden="true" />
          Yours
        </span>
        <span>
          <span className="legend-dot" style={{ width: 10, height: 10, border: '1.5px solid var(--accent)' }} aria-hidden="true" />
          Learnable now
        </span>
        <span>
          <span className="legend-dot" style={{ width: 7, height: 7, background: 'var(--node-muted)' }} aria-hidden="true" />
          Beyond your edge
        </span>
        {targets && (
          <span>
            <span className="legend-dot" style={{ width: 14, height: 14, border: '1px solid var(--text-secondary)' }} aria-hidden="true" />
            This goal needs it
          </span>
        )}
        <span>
          <span className="legend-diamond" aria-hidden="true" />
          Premises meet
        </span>
      </div>
    </Screen>
  );
}
