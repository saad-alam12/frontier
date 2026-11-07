import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MapNodeView, MapView } from '../../backend/api/contract';
import { placeLabels, plain, radiusOf } from '../lib/mapGraph';
import type { LabelBox, MapGraph, MapSettings, Rect } from '../lib/mapGraph';
import { depthName } from '../lib/stages';
import { Markdown } from './Markdown';
import { seriesColor } from './charts';

interface SimNode extends SimulationNodeDatum {
  id: string;
  junction: boolean;
  layer: number;
  dependents: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  from: string[];
  to: string;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 4;
const FONT_PX = 12;
const LABEL_H = 16;
const WARM_TICKS = 300;
/** Screen space the title, search and legend cover, kept clear when fitting. */
const FIT_INSET = { top: 180, right: 40, bottom: 64, left: 40 };
/** What floats over the map; labels are not placed under these. */
const OVERLAYS = '.map-head > *, .map-actions, .map-panel-wrap, .map-card, .map-legend, .map-zoom';

/** With reduced motion the map settles at once and the camera jumps instead of gliding. */
function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The on-screen boxes of the overlays matching `selector`, relative to the map. */
function overlayRects(wrap: HTMLElement | null, selector: string): Rect[] {
  const screen = wrap?.parentElement;
  if (!wrap || !screen) return [];
  const origin = wrap.getBoundingClientRect();
  return [...screen.querySelectorAll(selector)].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  });
}

/**
 * The knowledge map as a living graph (design §8), in the manner of Obsidian's graph view: ideas are
 * pulled together along their chains and pushed apart from each other, settle into clusters, and can
 * be dragged. Hovering an idea lights it, its neighbours and their links and fades the rest; labels
 * fade in as you zoom, never overlapping. Colours follow the learner's edge by default (ideas you own
 * ivory, learnable ones ringed, the rest muted), or a goal, a topic, or depth. Optionally,
 * prerequisites are pulled left and results right.
 */
export function MapCanvas({
  view,
  graph,
  settings,
  selectedId,
  matches,
  revealed,
  focus,
  fitKey,
  onSelect,
}: {
  view: MapView;
  graph: MapGraph;
  settings: MapSettings;
  selectedId: string | null;
  /** Search matches, outlined and labelled. */
  matches: Set<string>;
  /** While replaying how the map grew: only these are drawn. */
  revealed: Set<string> | null;
  /** Glide to this idea when it changes (search, links in the card). */
  focus: { id: string; seq: number } | null;
  /** Fit the view when this changes (a new filter); a data refresh keeps the camera. */
  fitKey: number;
  onSelect: (id: string | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const sim = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodes = useRef<Map<string, SimNode>>(new Map());
  const simLinks = useRef<SimLink[]>([]);
  const hover = useRef<string | null>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const raf = useRef(0);
  const colors = useMemo(readColors, []);
  const nodes = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view]);
  const goalIndex = useMemo(() => new Map(view.goals.map((g, i) => [g.id, i])), [view]);
  const topicIndex = useMemo(() => new Map(view.topics.slice(0, 6).map((t, i) => [t.id, i])), [view]);

  // everything the draw loop reads, kept current without re-subscribing the simulation
  const live = useRef({ graph, settings, selectedId, matches, revealed, nodes, size, goalIndex, topicIndex });
  live.current = { graph, settings, selectedId, matches, revealed, nodes, size, goalIndex, topicIndex };

  const draw = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => paint());
  }, []);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // fit the ideas into the area the overlays leave free (title and search above, legend below)
  const fit = useCallback(() => {
    const { w, h } = live.current.size;
    const ns = [...simNodes.current.values()].filter((n) => !n.junction);
    if (!ns.length || !w || !h) return;
    const xs = ns.map((n) => n.x ?? 0);
    const ys = ns.map((n) => n.y ?? 0);
    const minX = Math.min(...xs) - 20;
    const maxX = Math.max(...xs) + 140;
    const minY = Math.min(...ys) - 20;
    const maxY = Math.max(...ys) + 20;
    // an open idea card (left) or view panel (right) is kept clear too
    const side = (selector: string) => overlayRects(wrapRef.current, selector)[0];
    const card = side('.map-card');
    const panel = side('.map-panel-wrap');
    const inset = { ...FIT_INSET, left: Math.max(FIT_INSET.left, card ? card.x + card.w + 24 : 0), right: Math.max(FIT_INSET.right, panel ? w - panel.x + 24 : 0) };
    const free = { w: Math.max(100, w - inset.left - inset.right), h: Math.max(100, h - inset.top - inset.bottom) };
    const zoom = Math.max(MIN_ZOOM, Math.min(1.6, Math.min(free.w / (maxX - minX), free.h / (maxY - minY))));
    const centre = { x: inset.left + free.w / 2 - w / 2, y: inset.top + free.h / 2 - h / 2 };
    camera.current = { x: (minX + maxX) / 2 - centre.x / zoom, y: (minY + maxY) / 2 - centre.y / zoom, zoom };
    draw();
  }, [draw]);
  // after a new filter or layout the camera follows the ideas while they settle, until the learner moves it
  const following = useRef(false);

  // (Re)build the simulation when the visible graph changes; ideas that stay keep their place.
  const fitted = useRef(-1);
  useEffect(() => {
    const previous = simNodes.current;
    const next = new Map<string, SimNode>();
    const neighbourOf = (id: string) => [...(graph.neighbours.get(id) ?? [])].map((m) => previous.get(m)).find((m) => m?.x !== undefined);
    graph.nodes.forEach((g, i) => {
      const old = previous.get(g.id);
      const near = old ? undefined : neighbourOf(g.id);
      const angle = i * 2.399963; // golden angle: a deterministic spiral for ideas with nowhere to start
      const radius = 18 * Math.sqrt(i + 1);
      next.set(g.id, {
        id: g.id,
        junction: g.junction,
        layer: g.layer,
        dependents: g.dependents,
        x: old?.x ?? (near?.x ?? Math.cos(angle) * radius) + (near ? 12 * Math.cos(angle) : 0),
        y: old?.y ?? (near?.y ?? Math.sin(angle) * radius) + (near ? 12 * Math.sin(angle) : 0),
        vx: old?.vx ?? 0,
        vy: old?.vy ?? 0,
      });
    });
    simNodes.current = next;
    simLinks.current = graph.links.map((l) => ({ source: l.source, target: l.target, from: l.from, to: l.to }));
    const fresh = previous.size === 0;
    sim.current?.stop();
    const s = forceSimulation<SimNode, SimLink>([...next.values()]).stop();
    sim.current = s;
    applyForces(s, simLinks.current, live.current.settings, nodes);
    const still = reducedMotion();
    if (fresh || still) s.tick(WARM_TICKS);
    s.on('tick', () => {
      if (!following.current) return draw();
      fit();
      if (s.alpha() < 0.08) following.current = false;
    });
    s.alpha(still ? 0 : fresh ? 0.12 : 0.5).restart();
    return () => {
      s.stop();
    };
  }, [graph, nodes, draw, fit]);

  // forces follow the view panel at once; turning the flow on or off reshapes the map, so the camera follows it
  const flowWas = useRef(settings.flow);
  useEffect(() => {
    const s = sim.current;
    if (!s) return;
    applyForces(s, simLinks.current, settings, nodes);
    if (flowWas.current !== settings.flow) following.current = true;
    flowWas.current = settings.flow;
    if (reducedMotion()) s.tick(WARM_TICKS);
    s.alpha(reducedMotion() ? 0 : 0.45).restart();
  }, [settings.center, settings.repel, settings.linkStrength, settings.linkDistance, settings.flow, settings.nodeSize, nodes]);

  useEffect(() => {
    if (size.w && fitted.current !== fitKey) {
      fitted.current = fitKey;
      following.current = true;
      fit();
    }
  }, [fitKey, size, fit]);

  useEffect(draw, [draw, size, settings, selectedId, matches, revealed, nodes]);

  // glide to a focused idea, centred in the space beside its card once the card is open
  useEffect(() => {
    if (!focus) return;
    const target = simNodes.current.get(focus.id);
    if (!target || target.x === undefined || target.y === undefined) return;
    following.current = false;
    const start = { ...camera.current };
    const zoom = Math.max(start.zoom, 1.1);
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const card = overlayRects(wrapRef.current, '.map-card')[0];
      const beside = card && card.x + card.w < live.current.size.w / 2 ? (card.x + card.w) / 2 : 0;
      const end = { x: (target.x ?? 0) - beside / zoom, y: target.y ?? 0, zoom };
      const k = reducedMotion() ? 1 : Math.min(1, (t - t0) / 360);
      const e = 1 - (1 - k) ** 3;
      camera.current = { x: start.x + (end.x - start.x) * e, y: start.y + (end.y - start.y) * e, zoom: start.zoom + (end.zoom - start.zoom) * e };
      draw();
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [focus, draw]);

  const widths = useRef(new Map<string, string>());
  function paint() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { graph: g, settings: st, selectedId: selected, matches: found, revealed: shown, nodes: views, size: sz, goalIndex: goals, topicIndex: topicsAt } = live.current;
    if (!canvas || !ctx || !sz.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(sz.w * dpr) || canvas.height !== Math.round(sz.h * dpr)) {
      canvas.width = Math.round(sz.w * dpr);
      canvas.height = Math.round(sz.h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sz.w, sz.h);
    const cam = camera.current;
    const sx = (x: number) => (x - cam.x) * cam.zoom + sz.w / 2;
    const sy = (y: number) => (y - cam.y) * cam.zoom + sz.h / 2;
    const scale = Math.max(0.55, Math.min(1.8, Math.sqrt(cam.zoom)));
    const isShown = (id: string) => !shown || shown.has(id);
    const lens = hover.current ?? selected;
    const lit = lens ? new Set([lens, ...(g.neighbours.get(lens) ?? [])]) : null;
    const radius = (n: SimNode) => {
      const v = views.get(n.id);
      return v ? radiusOf(v, n.dependents, st.nodeSize) * scale : 0;
    };

    // links
    for (const pass of [false, true]) {
      for (const l of simLinks.current) {
        const a = l.source as SimNode;
        const b = l.target as SimNode;
        if (a.x === undefined || b.x === undefined || a.y === undefined || b.y === undefined) continue;
        if (!l.from.every(isShown) || !isShown(l.to)) continue;
        const on = lens !== null && (l.to === lens || l.from.includes(lens));
        if (on !== pass) continue;
        ctx.globalAlpha = on ? 0.9 : lit ? 0.05 : 0.18 + 0.25 * Math.min(1, cam.zoom);
        ctx.strokeStyle = on ? colors.accent : colors.link;
        ctx.lineWidth = st.linkWidth * (on ? 1.4 : 1);
        const x1 = sx(a.x);
        const y1 = sy(a.y);
        const x2 = sx(b.x);
        const y2 = sy(b.y);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (st.arrows && !b.junction) arrow(ctx, x1, y1, x2, y2, radius(b) + 2, on ? colors.accent : colors.link);
      }
    }

    // junctions: where a chain's premises meet
    for (const n of simNodes.current.values()) {
      if (!n.junction || n.x === undefined || n.y === undefined) continue;
      const link = simLinks.current.find((l) => (l.source as SimNode).id === n.id);
      if (link && (!link.from.every(isShown) || !isShown(link.to))) continue;
      const on = lens !== null && link !== undefined && (link.to === lens || link.from.includes(lens));
      const r = 2.6 * scale;
      const x = sx(n.x);
      const y = sy(n.y);
      ctx.globalAlpha = on ? 1 : lit ? 0.08 : 0.7;
      ctx.fillStyle = on ? colors.accent : colors.link;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
    }

    // ideas
    const boxes: LabelBox[] = [];
    for (const n of simNodes.current.values()) {
      if (n.junction || n.x === undefined || n.y === undefined || !isShown(n.id)) continue;
      const v = views.get(n.id);
      if (!v) continue;
      const x = sx(n.x);
      const y = sy(n.y);
      const r = radius(n);
      if (x < -60 || y < -60 || x > sz.w + 60 || y > sz.h + 60) continue;
      const faded = lit !== null && !lit.has(n.id);
      if (n.id === selected) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.accentHalo;
        ctx.beginPath();
        ctx.arc(x, y, r + 7, 0, Math.PI * 2);
        ctx.fill();
      }
      drawIdea(ctx, v, x, y, r, faded ? 0.14 : 1, st, colors, goals, topicsAt);
      if (found.has(n.id)) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (v.simplified) {
        ctx.globalAlpha = faded ? 0.14 : 0.9;
        ctx.fillStyle = colors.textSecondary;
        ctx.fillRect(x - 3, y + r + 2.5, 6, 1.6);
      }
      // label candidates: the lens and its neighbours, matches, and (zoomed in) everything
      const important = n.id === selected ? 1000 : n.id === hover.current ? 900 : lit?.has(n.id) ? 500 : found.has(n.id) ? 400 : 0;
      const zoomedIn = cam.zoom >= st.labelZoom;
      if (!important && (!zoomedIn || faded)) continue;
      const text = labelText(ctx, widths.current, plain(v.name));
      const w = ctx.measureText(text).width;
      boxes.push({ id: n.id, x: x + r + 5, y: y - LABEL_H / 2, w, h: LABEL_H, priority: important || 10 + n.dependents * 4 + (v.state === 'fringe' ? 3 : v.state === 'owned' ? 2 : 0) });
    }

    // labels last, never overlapping; ordinary ones fade in with zoom
    ctx.font = `400 ${FONT_PX}px Geist, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const fade = Math.max(0, Math.min(1, (cam.zoom - st.labelZoom) / (st.labelZoom * 0.35)));
    for (const b of placeLabels(boxes, sz.w, sz.h, overlayRects(wrapRef.current, OVERLAYS))) {
      const v = views.get(b.id);
      if (!v) continue;
      const strong = b.priority >= 400;
      ctx.globalAlpha = strong ? 1 : fade;
      if (strong) {
        ctx.fillStyle = colors.bg;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(b.x - 3, b.y, b.w + 6, b.h);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = b.id === selected || b.id === hover.current ? colors.text : v.state === 'fringe' ? colors.accentText : v.state === 'owned' ? colors.textSecondary : colors.textMuted;
      ctx.fillText(labelText(ctx, widths.current, plain(v.name)), b.x, b.y + b.h / 2);
    }
    ctx.globalAlpha = 1;
  }

  // pointer: drag an idea, pan the view, hover, click
  const gesture = useRef<{ kind: 'pan' | 'node'; id: string | null; x: number; y: number; cam: Camera; moved: boolean } | null>(null);
  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const cam = camera.current;
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - size.w / 2) / cam.zoom + cam.x, y: (clientY - rect.top - size.h / 2) / cam.zoom + cam.y };
  };
  const hitTest = (clientX: number, clientY: number): string | null => {
    const p = toWorld(clientX, clientY);
    const cam = camera.current;
    const scale = Math.max(0.55, Math.min(1.8, Math.sqrt(cam.zoom)));
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of simNodes.current.values()) {
      if (n.junction || n.x === undefined || n.y === undefined || (revealed && !revealed.has(n.id))) continue;
      const v = nodes.get(n.id);
      if (!v) continue;
      const r = (radiusOf(v, n.dependents, settings.nodeSize) * scale + 4) / cam.zoom;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= r && d < bestD) {
        best = n.id;
        bestD = d;
      }
    }
    return best;
  };
  const setHover = (id: string | null, clientX = 0, clientY = 0) => {
    if (id === hover.current) return;
    hover.current = id;
    if (canvasRef.current) canvasRef.current.style.cursor = id ? 'pointer' : 'grab';
    const rect = wrapRef.current?.getBoundingClientRect();
    setTip(id && rect ? { id, x: clientX - rect.left, y: clientY - rect.top } : null);
    draw();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      following.current = false;
      const cam = camera.current;
      // a pinch (ctrl) or a mouse wheel notch zooms; a trackpad's two-finger scroll pans
      const notch = e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
      if (e.ctrlKey || e.metaKey || notch) {
        const rect = canvas.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
        const px = e.clientX - rect.left - size.w / 2;
        const py = e.clientY - rect.top - size.h / 2;
        camera.current = { zoom, x: cam.x + px / cam.zoom - px / zoom, y: cam.y + py / cam.zoom - py / zoom };
      } else {
        camera.current = { ...cam, x: cam.x + e.deltaX / cam.zoom, y: cam.y + e.deltaY / cam.zoom };
      }
      setTip(null);
      draw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [size, draw]);

  const zoomBy = (factor: number) => {
    following.current = false;
    camera.current = { ...camera.current, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.current.zoom * factor)) };
    draw();
  };

  const tipNode = tip ? nodes.get(tip.id) : undefined;
  return (
    <div ref={wrapRef} className="map-canvas">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        role="img"
        aria-label="Map of your ideas. Search above to reach one by name; the ideas are also listed by state after the map."
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          const id = hitTest(e.clientX, e.clientY);
          following.current = false;
          gesture.current = { kind: id ? 'node' : 'pan', id, x: e.clientX, y: e.clientY, cam: { ...camera.current }, moved: false };
        }}
        onPointerMove={(e) => {
          const gst = gesture.current;
          if (!gst) {
            setHover(hitTest(e.clientX, e.clientY), e.clientX, e.clientY);
            return;
          }
          const dx = e.clientX - gst.x;
          const dy = e.clientY - gst.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) gst.moved = true;
          if (!gst.moved) return;
          if (gst.kind === 'pan') {
            camera.current = { ...gst.cam, x: gst.cam.x - dx / gst.cam.zoom, y: gst.cam.y - dy / gst.cam.zoom };
            setTip(null);
            draw();
            return;
          }
          const n = gst.id ? simNodes.current.get(gst.id) : undefined;
          if (!n) return;
          const p = toWorld(e.clientX, e.clientY);
          n.fx = p.x;
          n.fy = p.y;
          setTip(null);
          sim.current?.alphaTarget(0.25).restart();
        }}
        onPointerUp={(e) => {
          const gst = gesture.current;
          gesture.current = null;
          if (!gst) return;
          if (gst.kind === 'node' && gst.id) {
            const n = simNodes.current.get(gst.id);
            if (n) {
              n.fx = null;
              n.fy = null;
            }
            sim.current?.alphaTarget(0);
          }
          if (!gst.moved) onSelect(hitTest(e.clientX, e.clientY));
        }}
        onPointerLeave={() => setHover(null)}
      />
      {tip && tipNode && (
        <div className="tip map-tip" style={{ left: Math.min(tip.x + 14, size.w - 250), top: Math.max(0, tip.y + 12) }}>
          <div className="tip-title">
            <Markdown text={tipNode.name} inline />
          </div>
          <div className="tip-line">{tipLine(tipNode)}</div>
          {tipNode.goals.length > 0 && <div className="tip-meta">For {tipNode.goals.map((g) => view.goals.find((x) => x.id === g)?.title ?? g).join(', ')}</div>}
          {tipNode.simplified && <div className="tip-meta">Simplified for a goal</div>}
          {tipNode.cards > 0 && <div className="tip-meta">{tipNode.cards === 1 ? '1 flashcard' : `${tipNode.cards} flashcards`}</div>}
        </div>
      )}
      <div className="map-zoom" role="group" aria-label="Zoom">
        <button type="button" className="map-button" onClick={fit}>
          Fit
        </button>
        <button type="button" className="map-button" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>
          +
        </button>
        <button type="button" className="map-button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
          −
        </button>
      </div>
    </div>
  );
}

function tipLine(n: MapNodeView): string {
  if (n.state === 'owned') return `Yours: ${depthName(n.depth).toLowerCase()}, ${Math.round(n.recall * 100)}% recall now`;
  if (n.state === 'fringe') return n.unverified ? 'Learnable now, not in your material yet' : 'Learnable now';
  return n.depth > 0 ? `Beyond your edge, seen at ${depthName(n.depth).toLowerCase()}` : 'Beyond your edge';
}

/** The simulation's forces from the view panel: links along chains, repulsion, a pull to the centre, and optionally a left-to-right pull by layer. */
function applyForces(s: Simulation<SimNode, SimLink>, links: SimLink[], st: MapSettings, views: Map<string, MapNodeView>): void {
  const spread = st.linkDistance * 1.6;
  const gravity = 0.02 + 0.18 * st.center;
  const middle = Math.max(0, ...s.nodes().map((d) => d.layer)) / 2;
  s.force(
    'link',
    forceLink<SimNode, SimLink>(links)
      .id((d) => d.id)
      .distance((l) => ((l.source as SimNode).junction || (l.target as SimNode).junction ? st.linkDistance * 0.45 : st.linkDistance))
      .strength(0.05 + 0.95 * st.linkStrength),
  );
  s.force(
    'charge',
    forceManyBody<SimNode>()
      .strength((d) => (d.junction ? -8 : -(25 + 300 * st.repel)))
      .distanceMax(700),
  );
  s.force('x', st.flow ? forceX<SimNode>((d) => (d.layer - middle) * spread).strength(0.3) : forceX<SimNode>(0).strength(gravity));
  s.force('y', forceY<SimNode>(0).strength(gravity));
  s.force(
    'collide',
    forceCollide<SimNode>((d) => {
      const v = views.get(d.id);
      return d.junction || !v ? 3 : radiusOf(v, d.dependents, st.nodeSize) + 3;
    }),
  );
}

function drawIdea(
  ctx: CanvasRenderingContext2D,
  v: MapNodeView,
  x: number,
  y: number,
  r: number,
  alpha: number,
  st: MapSettings,
  c: ReturnType<typeof readColors>,
  goalIndex: Map<string, number>,
  topicIndex: Map<string, number>,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (st.colorBy === 'state') {
    if (v.state === 'owned') {
      ctx.globalAlpha = alpha * (0.45 + 0.55 * v.recall);
      ctx.fillStyle = c.text;
      ctx.fill();
    } else if (v.state === 'fringe') {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = c.bg;
      ctx.fill();
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.5;
      if (v.unverified) ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = c.nodeMuted;
      ctx.fill();
    }
    return;
  }
  ctx.globalAlpha = alpha;
  if (st.colorBy === 'depth') {
    ctx.fillStyle = v.depth > 0 ? mix(c.nodeMuted, c.text, v.depth / 5) : c.nodeMuted;
  } else if (st.colorBy === 'goal') {
    const i = v.goals.map((g) => goalIndex.get(g) ?? -1).find((x) => x >= 0);
    ctx.fillStyle = i === undefined ? c.nodeMuted : seriesColor(i);
  } else {
    const i = v.topic ? topicIndex.get(v.topic) : undefined;
    ctx.fillStyle = i === undefined ? c.nodeMuted : seriesColor(i);
  }
  ctx.fill();
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, back: number, color: string): void {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < back + 6) return;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const tx = x2 - ux * back;
  const ty = y2 - uy * back;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - ux * 6 - uy * 3, ty - uy * 6 + ux * 3);
  ctx.lineTo(tx - ux * 6 + uy * 3, ty - uy * 6 - ux * 3);
  ctx.closePath();
  ctx.fill();
}

/** A label cut to at most 240 px (cached per name). */
function labelText(ctx: CanvasRenderingContext2D, cache: Map<string, string>, name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  ctx.font = `400 ${FONT_PX}px Geist, system-ui, sans-serif`;
  let text = name;
  if (ctx.measureText(text).width > 240) {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(`${text.slice(0, mid)}…`).width <= 240) lo = mid;
      else hi = mid - 1;
    }
    text = `${text.slice(0, lo).trimEnd()}…`;
  }
  cache.set(name, text);
  return text;
}

function mix(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const ch = (i: number) => Math.round((pa[i] ?? 0) + ((pb[i] ?? 0) - (pa[i] ?? 0)) * t);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

function hex(color: string): number[] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m || !m[1]) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg', '#141311'),
    text: v('--text', '#eeeae2'),
    textSecondary: v('--text-secondary', '#ada79b'),
    textMuted: v('--text-muted', '#8c877c'),
    nodeMuted: v('--node-muted', '#4a463f'),
    link: v('--node-muted', '#4a463f'),
    accent: v('--accent', '#8ea4ff'),
    accentText: v('--accent-text', '#b4c2ff'),
    accentHalo: v('--accent-halo', 'rgba(142,164,255,0.18)'),
  };
}
