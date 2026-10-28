import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MapNodeView } from '../../backend/api/contract';
import { LABEL_HEIGHT } from '../lib/mapLayout';
import type { MapLayout } from '../lib/mapLayout';

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const MIN_ZOOM = 0.06;
const MAX_ZOOM = 2.5;
const FONT_PX = 12;
/** Below this on-screen font size, only important labels are drawn (at a fixed readable size). */
const MIN_LABEL_PX = 8.5;

/**
 * The full knowledge map on a canvas, so hundreds of ideas pan and zoom smoothly. Ideas you own are
 * ivory, sized by depth and faded by how fresh they are; ideas learnable now have an accent ring;
 * ideas beyond your edge are small and muted. A selected goal outlines its targets and dims what
 * it does not need. Chains with several premises meet at a small diamond before their conclusion.
 */
export function MapCanvas({
  layout,
  nodes,
  selectedId,
  goalTargets,
  goalScope,
  focus,
  onSelect,
}: {
  layout: MapLayout;
  nodes: Map<string, MapNodeView>;
  selectedId: string | null;
  goalTargets: Set<string> | null;
  goalScope: Set<string> | null;
  /** Centre on this idea when it changes (search, links in the card). */
  focus: { id: string; seq: number } | null;
  onSelect: (id: string | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const [frame, setFrame] = useState(0);
  const redraw = useCallback(() => setFrame((f) => f + 1), []);
  const hover = useRef<string | null>(null);
  const colors = useMemo(readColors, []);

  /**
   * Fit the graph's height (labels stay legible) and start at its roots on the left; a graph wider
   * than the view is explored by dragging right. A second press shows everything at once.
   */
  const fitMode = useRef<'height' | 'all'>('all');
  const fit = useCallback(() => {
    fitMode.current = fitMode.current === 'all' ? 'height' : 'all';
    const b = fitMode.current === 'height' ? layout.graphBounds : layout.bounds;
    const width = b.maxX - b.minX;
    const height = b.maxY - b.minY;
    const zoom =
      fitMode.current === 'height'
        ? Math.max(MIN_ZOOM, Math.min(1, (size.h / height) * 0.9))
        : Math.max(MIN_ZOOM, Math.min(1, Math.min(size.w / width, size.h / height) * 0.92));
    const x = width * zoom <= size.w ? (b.minX + b.maxX) / 2 : b.minX + size.w / 2 / zoom - 24 / zoom;
    camera.current = { x, y: (b.minY + b.maxY) / 2, zoom };
    redraw();
  }, [layout, size, redraw]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);
  const fitted = useRef<MapLayout | null>(null);
  useEffect(() => {
    if (fitted.current !== layout && size.w > 0) {
      fitted.current = layout;
      fit();
    }
  }, [layout, size, fit]);

  const positions = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  // Glide to a focused idea.
  useEffect(() => {
    if (!focus) return;
    const target = positions.get(focus.id);
    if (!target) return;
    const start = { ...camera.current };
    const end = { x: target.x + 80, y: target.y, zoom: Math.max(start.zoom, 0.9) };
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 320);
      const e = 1 - (1 - k) ** 3;
      camera.current = { x: start.x + (end.x - start.x) * e, y: start.y + (end.y - start.y) * e, zoom: start.zoom + (end.zoom - start.zoom) * e };
      redraw();
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [focus, positions, redraw]);

  // Labels are cut to their box once, in world units; uniform zoom keeps them fitting.
  const labels = useMemo(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    const out = new Map<string, string>();
    if (!ctx) return out;
    ctx.font = `400 ${FONT_PX}px Geist, system-ui, sans-serif`;
    for (const n of layout.nodes) out.set(n.id, fitText(ctx, plain(nodes.get(n.id)?.name ?? n.id), n.label.width));
    return out;
  }, [layout, nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const cam = camera.current;
    const sx = (x: number) => (x - cam.x) * cam.zoom + size.w / 2;
    const sy = (y: number) => (y - cam.y) * cam.zoom + size.h / 2;
    const inView = (x: number, y: number, pad = 40) => x > -pad && x < size.w + pad && y > -pad && y < size.h + pad;
    const dim = (id: string) => (goalScope && !goalScope.has(id) ? 0.28 : 1);
    const lit = (from: string, to: string) => selectedId !== null && (from === selectedId || to === selectedId);

    // links
    ctx.lineWidth = 1;
    for (const pass of [false, true]) {
      for (const l of layout.links) {
        const on = lit(l.from, l.to);
        if (on !== pass) continue;
        const x1 = sx(l.x1);
        const y1 = sy(l.y1);
        const x2 = sx(l.x2);
        const y2 = sy(l.y2);
        if (!inView(x1, y1, 400) && !inView(x2, y2, 400)) continue;
        const dx = (x2 - x1) * 0.5;
        // far out, hundreds of chains would read as haze: links fade with zoom until one is selected
        ctx.globalAlpha = on ? 0.85 : (0.14 + 0.32 * Math.min(1, cam.zoom)) * Math.min(dim(l.from), dim(l.to));
        ctx.strokeStyle = on ? colors.accent : colors.nodeMuted;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
        ctx.stroke();
      }
    }
    // chain markers
    for (const m of layout.markers) {
      const x = sx(m.x);
      const y = sy(m.y);
      if (!inView(x, y)) continue;
      const on = selectedId !== null && (m.conclusion === selectedId || m.premises.includes(selectedId));
      const r = Math.max(2, 3.2 * Math.min(1, cam.zoom + 0.2));
      ctx.globalAlpha = on ? 1 : 0.8 * dim(m.conclusion);
      ctx.fillStyle = on ? colors.accent : colors.nodeMuted;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
    }
    // ideas
    const scale = Math.max(0.55, Math.min(1.3, cam.zoom));
    for (const p of layout.nodes) {
      const n = nodes.get(p.id);
      if (!n) continue;
      const x = sx(p.x);
      const y = sy(p.y);
      if (!inView(x, y)) continue;
      const a = dim(p.id);
      if (p.id === selectedId) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.accentHalo;
        ctx.beginPath();
        ctx.arc(x, y, 12 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      if (goalTargets?.has(p.id)) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = colors.textSecondary;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 9 * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (n.state === 'owned') {
        ctx.globalAlpha = a * (0.4 + 0.6 * n.recall);
        ctx.fillStyle = colors.text;
        ctx.beginPath();
        ctx.arc(x, y, (2.6 + n.depth * 0.75) * scale, 0, Math.PI * 2);
        ctx.fill();
      } else if (n.state === 'fringe') {
        ctx.globalAlpha = a;
        ctx.fillStyle = colors.bg;
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5;
        if (n.unverified) ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(x, y, 5 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = colors.nodeMuted;
        ctx.beginPath();
        ctx.arc(x, y, 3.2 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // labels: all of them when legible; otherwise only the important ones, never overlapping
    const fontPx = FONT_PX * cam.zoom;
    const colorOf = (n: MapNodeView, id: string) => (id === selectedId || id === hover.current ? colors.text : n.state === 'fringe' ? colors.accentText : n.state === 'owned' ? colors.textMuted : colors.textFaint);
    ctx.textBaseline = 'middle';
    if (fontPx >= MIN_LABEL_PX) {
      ctx.font = `400 ${fontPx}px Geist, system-ui, sans-serif`;
      for (const p of layout.nodes) {
        const n = nodes.get(p.id);
        const x = sx(p.label.x);
        const y = sy(p.y);
        if (!n || !inView(x, y, 300)) continue;
        ctx.globalAlpha = dim(p.id);
        ctx.fillStyle = colorOf(n, p.id);
        ctx.fillText(labels.get(p.id) ?? '', x, y);
      }
    } else {
      ctx.font = `400 11px Geist, system-ui, sans-serif`;
      const taken: { x: number; y: number; w: number; h: number }[] = [];
      const important = layout.nodes
        .map((p) => ({ p, n: nodes.get(p.id) }))
        .filter((e): e is { p: (typeof layout.nodes)[number]; n: MapNodeView } => e.n !== undefined && (e.p.id === selectedId || e.p.id === hover.current || goalTargets?.has(e.p.id) === true || e.n.state === 'fringe'))
        .sort((a, b) => rank(b.p.id) - rank(a.p.id));
      function rank(id: string) {
        return (id === selectedId ? 100 : 0) + (id === hover.current ? 50 : 0) + (goalTargets?.has(id) ? 10 : 0) + (nodes.get(id)?.state === 'fringe' ? 5 : 0);
      }
      for (const { p, n } of important) {
        const text = labels.get(p.id) ?? '';
        const w = Math.min(ctx.measureText(text).width, 200);
        const box = { x: sx(p.x) + 8, y: sy(p.y) - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT };
        if (!inView(box.x, box.y)) continue;
        if (taken.some((t) => box.x < t.x + t.w + 4 && t.x < box.x + box.w + 4 && box.y < t.y + t.h && t.y < box.y + box.h)) continue;
        taken.push(box);
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.bg;
        ctx.fillRect(box.x - 2, box.y, box.w + 4, box.h);
        ctx.fillStyle = colorOf(n, p.id);
        ctx.fillText(text.length > 34 ? `${text.slice(0, 33)}…` : text, box.x, sy(p.y));
      }
    }
    ctx.globalAlpha = 1;
  }, [frame, size, layout, nodes, selectedId, goalTargets, goalScope, labels, colors]);

  // pan, zoom, click
  const drag = useRef<{ x: number; y: number; cam: Camera; moved: boolean } | null>(null);
  const hitTest = (clientX: number, clientY: number): string | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const cam = camera.current;
    const wx = (clientX - rect.left - size.w / 2) / cam.zoom + cam.x;
    const wy = (clientY - rect.top - size.h / 2) / cam.zoom + cam.y;
    let best: string | null = null;
    let bestD = (12 / cam.zoom) ** 2;
    for (const n of layout.nodes) {
      const d = (n.x - wx) ** 2 + (n.y - wy) ** 2;
      const onLabel = wx >= n.label.x && wx <= n.label.x + n.label.width && Math.abs(wy - n.y) <= LABEL_HEIGHT / 2 && cam.zoom * FONT_PX >= MIN_LABEL_PX;
      if (d < bestD || onLabel) {
        best = n.id;
        bestD = onLabel ? 0 : d;
      }
    }
    return best;
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cam = camera.current;
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
      const px = e.clientX - rect.left - size.w / 2;
      const py = e.clientY - rect.top - size.h / 2;
      camera.current = { zoom, x: cam.x + px / cam.zoom - px / zoom, y: cam.y + py / cam.zoom - py / zoom };
      redraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [size, redraw]);

  return (
    <div ref={wrapRef} className="map-canvas">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        role="img"
        aria-label="Map of your ideas. Use the search box to find an idea, or the list beside the map."
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, cam: { ...camera.current }, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            camera.current = { ...d.cam, x: d.cam.x - dx / d.cam.zoom, y: d.cam.y - dy / d.cam.zoom };
            redraw();
            return;
          }
          const id = hitTest(e.clientX, e.clientY);
          if (id !== hover.current) {
            hover.current = id;
            if (canvasRef.current) canvasRef.current.style.cursor = id ? 'pointer' : 'grab';
            redraw();
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) onSelect(hitTest(e.clientX, e.clientY));
        }}
      />
      <div className="map-controls">
        <button type="button" className="mini-chip" onClick={fit}>
          Fit
        </button>
        <button type="button" className="mini-chip" aria-label="Zoom in" onClick={() => ((camera.current = { ...camera.current, zoom: Math.min(MAX_ZOOM, camera.current.zoom * 1.4) }), redraw())}>
          +
        </button>
        <button type="button" className="mini-chip" aria-label="Zoom out" onClick={() => ((camera.current = { ...camera.current, zoom: Math.max(MIN_ZOOM, camera.current.zoom / 1.4) }), redraw())}>
          −
        </button>
      </div>
    </div>
  );
}

function readColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg', '#141311'),
    text: v('--text', '#eeeae2'),
    textSecondary: v('--text-secondary', '#ada79b'),
    textMuted: v('--text-muted', '#8c877c'),
    textFaint: v('--text-faint', '#6f6a60'),
    nodeMuted: v('--node-muted', '#4a463f'),
    accent: v('--accent', '#8ea4ff'),
    accentText: v('--accent-text', '#b4c2ff'),
    accentHalo: v('--accent-halo', 'rgba(142,164,255,0.18)'),
  };
}

/** Canvas text has no KaTeX: drop math delimiters and commands to a readable approximation. */
export function plain(name: string): string {
  return name
    .replace(/\$/g, '')
    .replace(/\\(mathbf|mathrm|text|operatorname)\{([^}]*)\}/g, '$2')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '');
}

function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}
