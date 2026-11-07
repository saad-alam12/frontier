import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapState, MapView, NodeCard } from '../../backend/api/contract';
import { call, onEvent } from '../api';
import { Screen } from '../components/Shell';
import { Empty, MetaLine } from '../components/controls';
import { Markdown } from '../components/Markdown';
import { MapCanvas } from '../components/MapCanvas';
import { MapViewPanel } from '../components/MapViewPanel';
import { NodeCardView } from '../components/NodeCard';
import type { ChooseInit } from '../components/ChooseSheet';
import { IdeaFlashcards } from '../components/IdeaFlashcards';
import { seriesColor } from '../components/charts';
import { DEFAULT_SETTINGS, buildGraph, growthOrder, mergeSettings, plain, visibleIdeas } from '../lib/mapGraph';
import type { MapSettings } from '../lib/mapGraph';

const SETTINGS_KEY = 'frontier.map.settings';
const GROWTH_MS = 6000;

function loadSettings(): MapSettings {
  try {
    return mergeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * The whole knowledge map as a living graph that fills the window (design §8): find an idea, filter
 * and colour it from the view panel, hover to see what an idea connects to, open its card, show only
 * its neighbourhood, replay how the map grew, or go full screen.
 */
export function MapScreen({
  onOpenTrail,
  onGoDeeper,
  onChoose,
  initialId = null,
}: {
  onOpenTrail: (sessionId: string) => void;
  onGoDeeper: (goalId: string, nodeIds?: string[]) => Promise<void>;
  /** "Learn this now" on an idea's card: the sheet opens with it picked (and its goal, when it has one). */
  onChoose: (init: ChooseInit) => void;
  /** An idea to open on arrival ("Show on map"). */
  initialId?: string | null;
}) {
  const [map, setMap] = useState<MapView | null>(null);
  const [settings, setSettings] = useState<MapSettings>(loadSettings);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [card, setCard] = useState<NodeCard | null>(null);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(initialId ? { id: initialId, seq: 1 } : null);
  const [hops, setHops] = useState(0);
  const [panel, setPanel] = useState(false);
  const [full, setFull] = useState(false);
  const [growth, setGrowth] = useState<{ order: string[]; shown: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => setMap(await call('map.view')), []);
  useEffect(() => {
    void refresh();
    const offs = [onEvent('practice.graded', () => void refresh()), onEvent('goals.changed', () => void refresh())];
    return () => offs.forEach((off) => off());
  }, [refresh]);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // a per-device convenience: without storage the map just starts from the defaults next time
    }
  }, [settings]);
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

  // a goal that no longer exists is forgotten
  const goalId = settings.goalId && map?.goals.some((g) => g.id === settings.goalId) ? settings.goalId : null;
  const localId = hops > 0 ? selected : null;
  const visible = useMemo(() => (map ? visibleIdeas(map, { ...settings, goalId }, localId ? { id: localId, hops } : null) : new Set<string>()), [map, settings, goalId, localId, hops]);
  // the simulation is rebuilt only when what is shown changes, so a data refresh keeps the picture still
  const structure = `${[...visible].sort().join(',')}|${(map?.chains ?? []).map((c) => c.id).join(',')}`;
  const graphRef = useRef<{ key: string; graph: ReturnType<typeof buildGraph> } | null>(null);
  if (map && graphRef.current?.key !== structure) graphRef.current = { key: structure, graph: buildGraph(map, visible) };
  const graph = map ? (graphRef.current?.graph ?? null) : null;
  const filterKey = `${JSON.stringify(settings.show)}|${goalId}|${settings.simplifiedOnly}|${settings.cardsOnly}|${settings.hideLoose}|${localId}|${hops}`;
  const [fitKey, setFitKey] = useState(0);
  useEffect(() => setFitKey((k) => k + 1), [filterKey]);

  const matchList = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !map) return [];
    return map.nodes.filter((n) => plain(n.name).toLowerCase().includes(q));
  }, [query, map]);
  const matches = useMemo(() => new Set(matchList.map((n) => n.id)), [matchList]);

  const select = (id: string | null) => {
    setSelected(id);
    if (!id) setHops(0);
    if (id) setFocus((f) => ({ id, seq: (f?.seq ?? 0) + 1 }));
  };

  // full screen covers the window; Esc leaves it (the system handles that)
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  }, []);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === stageRef.current && stageRef.current !== null);
    document.addEventListener('fullscreenchange', onChange);
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      // keys inside a sheet (a flashcard being written) are the sheet's
      const inSheet = e.target instanceof Element && e.target.closest('dialog') !== null;
      if (typing || inSheet || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F') toggleFull();
      if (e.key === 'Escape' && !document.fullscreenElement) setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
    };
  }, [toggleFull]);

  // replay how the map grew: ideas appear in the order they were first learned, then the rest
  useEffect(() => {
    if (!growth || growth.shown >= growth.order.length) return;
    const step = Math.max(1, Math.ceil(growth.order.length / (GROWTH_MS / 50)));
    const t = window.setTimeout(() => setGrowth((g) => (g ? { ...g, shown: Math.min(g.order.length, g.shown + step) } : g)), 50);
    return () => window.clearTimeout(t);
  }, [growth]);
  const revealed = useMemo(() => (growth && growth.shown < growth.order.length ? new Set(growth.order.slice(0, growth.shown)) : null), [growth]);

  if (!map || !graph) return <Screen>{null}</Screen>;
  if (map.nodes.length === 0) {
    return (
      <Screen>
        <h1 className="t-display">Map</h1>
        <Empty>Your map grows as you add material in Library and learn in sessions.</Empty>
      </Screen>
    );
  }

  const shownIdeas = map.nodes.filter((n) => visible.has(n.id));
  return (
    <div ref={stageRef} className={full ? 'map-screen is-full' : 'map-screen'}>
      <MapCanvas view={map} graph={graph} settings={{ ...settings, goalId }} selectedId={selected} matches={matches} revealed={revealed} focus={focus} fitKey={fitKey} onSelect={select} />

      <div className="map-overlay map-head">
        <h1 className="t-display">Map</h1>
        <MetaLine
          small
          items={[
            `${shownIdeas.filter((n) => n.state === 'owned').length} yours`,
            `${shownIdeas.filter((n) => n.state === 'fringe').length} learnable now`,
            `${shownIdeas.filter((n) => n.state === 'beyond').length} beyond your edge`,
            shownIdeas.length < map.nodes.length ? `${map.nodes.length - shownIdeas.length} hidden` : null,
          ]}
        />
        <div className="map-search">
          <input
            className="input"
            aria-label="Find an idea"
            placeholder="Find an idea"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matchList[0]) {
                select(matchList[0].id);
                setQuery('');
              }
              if (e.key === 'Escape') setQuery('');
            }}
          />
          {matchList.length > 0 && (
            <ul className="list-card map-matches">
              {matchList.slice(0, 6).map((n) => (
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

      <div className="map-overlay map-actions">
        <button type="button" className="map-button" aria-pressed={panel} onClick={() => setPanel(!panel)}>
          View
        </button>
        <button type="button" className="map-button" disabled={growth !== null && revealed !== null} onClick={() => setGrowth({ order: growthOrder(shownIdeas), shown: 0 })}>
          Replay how it grew
        </button>
        <button type="button" className="map-button" onClick={toggleFull}>
          {full ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>

      {panel && (
        <div className="map-overlay map-panel-wrap">
          <MapViewPanel view={map} settings={settings} onChange={setSettings} />
        </div>
      )}

      {card && (
        <aside className="map-overlay map-card" aria-label="Idea">
          <div className="map-card-bar">
            <span className="t-small text-muted">Only its neighbourhood</span>
            <button type="button" className="map-button" aria-label="Close" onClick={() => select(null)}>
              ×
            </button>
          </div>
          <div className="toggle-row" role="radiogroup" aria-label="Only its neighbourhood">
            {[0, 1, 2, 3].map((h) => (
              <button key={h} type="button" role="radio" aria-checked={hops === h} className="mini-chip" onClick={() => setHops(h)}>
                {h === 0 ? 'Off' : `${h} ${h === 1 ? 'step' : 'steps'}`}
              </button>
            ))}
          </div>
          <NodeCardView
            card={card}
            onSelect={(id) => select(id)}
            onTrail={onOpenTrail}
            onGoDeeper={onGoDeeper}
            onLearn={(id) => {
              const goals = map?.nodes.find((n) => n.id === id)?.goals ?? [];
              onChoose({ pick: [id], goalId: goals.length === 1 ? goals[0] : null });
            }}
            compact
            extra={<IdeaFlashcards key={card.id} idea={{ id: card.id, name: card.name }} />}
          />
        </aside>
      )}

      <div className="map-overlay map-legend">
        <Legend map={map} settings={settings} />
      </div>

      <section className="sr-only" aria-label="Ideas on the map by state">
        {(['owned', 'fringe', 'beyond'] as const).map((state) => (
          <div key={state}>
            <h2>{STATE_HEADING[state]}</h2>
            <ul>
              {shownIdeas
                .filter((n) => n.state === state)
                .map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => select(n.id)}>
                      {plain(n.name)}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

const STATE_HEADING: Record<MapState, string> = { owned: 'Yours', fringe: 'Learnable now', beyond: 'Beyond your edge' };

/** What the colours mean, for the current colouring. */
function Legend({ map, settings }: { map: MapView; settings: MapSettings }) {
  if (settings.colorBy === 'goal' || settings.colorBy === 'topic') {
    const items = settings.colorBy === 'goal' ? map.goals.map((g) => g.title) : map.topics.slice(0, 6).map((t) => plain(t.name));
    return (
      <>
        {items.map((label, i) => (
          <span key={label}>
            <span className="legend-dot" style={{ width: 9, height: 9, background: seriesColor(i) }} aria-hidden="true" />
            {label}
          </span>
        ))}
        <span>
          <span className="legend-dot" style={{ width: 9, height: 9, background: 'var(--node-muted)' }} aria-hidden="true" />
          {settings.colorBy === 'goal' ? 'No goal' : 'Other'}
        </span>
      </>
    );
  }
  if (settings.colorBy === 'depth') {
    return (
      <span>
        <span className="legend-ramp" aria-hidden="true" />
        Not yet to transfer
      </span>
    );
  }
  return (
    <>
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
      <span>
        <span className="legend-diamond" aria-hidden="true" />
        Premises meet
      </span>
      <span>
        <span className="legend-bar" aria-hidden="true" />
        Simplified
      </span>
    </>
  );
}
