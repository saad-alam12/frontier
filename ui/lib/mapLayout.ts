/**
 * The full map's layout (design §8), in world units the canvas pans and zooms over. Ideas are
 * placed in columns by how far they are from a root along their shortest derivation, so the
 * picture reads left to right from definitions to results. Rows within a column are ordered by a
 * few barycentre sweeps to keep chains short. Ideas with no chains at all sit in a grid below.
 * Each idea's label has a fixed box right of its point that ends before the next column, so at
 * any zoom labels never overlap each other or a point. Deterministic: same graph, same picture.
 */

export interface MapLayoutInput {
  nodes: { id: string; name: string }[];
  chains: { id: string; premises: string[]; conclusion: string }[];
}

export interface PlacedMapNode {
  id: string;
  x: number;
  y: number;
  layer: number;
  /** Label box in world units: starts right of the point, ends before the next column. */
  label: { x: number; y: number; width: number; height: number };
}

export interface MapLink {
  chainId: string;
  /** The two ideas this segment connects (premise and conclusion), for highlighting. */
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MapLayout {
  nodes: PlacedMapNode[];
  /** Implication markers: where the premises of a chain with several premises meet. */
  markers: { chainId: string; x: number; y: number; premises: string[]; conclusion: string }[];
  links: MapLink[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Bounds of the ideas joined by chains (the grid of loose ideas below left out): what the view fits first. */
  graphBounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export const COL = 240;
export const ROW = 30;
export const LABEL_GAP = 10;
export const LABEL_HEIGHT = 16;
/** Markers sit this far left of their conclusion, clear of the previous column's labels. */
export const MARKER_OFFSET = 18;
const MAX_LAYER = 40;
const SWEEPS = 6;
const GRID_GAP = 72;

export function layoutMap(input: MapLayoutInput): MapLayout {
  const ids = new Set(input.nodes.map((n) => n.id));
  const chains = input.chains.filter((c) => ids.has(c.conclusion) && c.premises.length > 0 && c.premises.every((p) => ids.has(p)));
  const into = new Map<string, typeof chains>();
  const neighboursBefore = new Map<string, string[]>();
  const neighboursAfter = new Map<string, string[]>();
  const connected = new Set<string>();
  for (const c of chains) {
    into.set(c.conclusion, [...(into.get(c.conclusion) ?? []), c]);
    connected.add(c.conclusion);
    for (const p of c.premises) {
      connected.add(p);
      neighboursBefore.set(c.conclusion, [...(neighboursBefore.get(c.conclusion) ?? []), p]);
      neighboursAfter.set(p, [...(neighboursAfter.get(p) ?? []), c.conclusion]);
    }
  }

  // Layer = 1 + the deepest premise of the shortest chain; relaxed until stable (cycles are capped).
  const layer = new Map<string, number>();
  for (const id of connected) layer.set(id, 0);
  for (let round = 0; round < MAX_LAYER; round += 1) {
    let changed = false;
    for (const [conclusion, list] of into) {
      const best = Math.min(...list.map((c) => 1 + Math.max(...c.premises.map((p) => layer.get(p) ?? 0))));
      const next = Math.min(MAX_LAYER, best);
      if (next !== layer.get(conclusion)) {
        layer.set(conclusion, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const names = new Map(input.nodes.map((n) => [n.id, n.name]));
  const byName = (a: string, b: string) => (names.get(a) ?? '').localeCompare(names.get(b) ?? '') || a.localeCompare(b);
  const columns: string[][] = [];
  for (const id of [...connected].sort(byName)) {
    const l = layer.get(id) ?? 0;
    (columns[l] ??= []).push(id);
  }
  for (let l = 0; l < columns.length; l += 1) columns[l] ??= [];

  const position = new Map<string, number>();
  const index = () => columns.forEach((col) => col.forEach((id, i) => position.set(id, i - (col.length - 1) / 2)));
  index();
  const sweep = (col: string[], neighbours: Map<string, string[]>) => {
    const key = new Map(
      col.map((id) => {
        const ns = (neighbours.get(id) ?? []).map((n) => position.get(n)).filter((p): p is number => p !== undefined);
        return [id, ns.length ? ns.reduce((s, p) => s + p, 0) / ns.length : (position.get(id) ?? 0)];
      }),
    );
    col.sort((a, b) => (key.get(a) ?? 0) - (key.get(b) ?? 0) || byName(a, b));
    col.forEach((id, i) => position.set(id, i - (col.length - 1) / 2));
  };
  for (let s = 0; s < SWEEPS; s += 1) {
    if (s % 2 === 0) for (let l = 1; l < columns.length; l += 1) sweep(columns[l] as string[], neighboursBefore);
    else for (let l = columns.length - 2; l >= 0; l -= 1) sweep(columns[l] as string[], neighboursAfter);
  }

  const labelWidth = COL - LABEL_GAP - MARKER_OFFSET - 14;
  const place = (id: string, x: number, y: number, l: number): PlacedMapNode => ({ id, x, y, layer: l, label: { x: x + LABEL_GAP, y: y - LABEL_HEIGHT / 2, width: labelWidth, height: LABEL_HEIGHT } });
  const nodes: PlacedMapNode[] = [];
  columns.forEach((col, l) => col.forEach((id) => nodes.push(place(id, l * COL, (position.get(id) ?? 0) * ROW, l))));

  // Ideas with no chains: a grid under the graph, as wide as the graph.
  const isolated = input.nodes.map((n) => n.id).filter((id) => !connected.has(id)).sort(byName);
  if (isolated.length) {
    const perRow = Math.max(3, columns.length);
    const top = (nodes.length ? Math.max(...nodes.map((n) => n.y)) : 0) + GRID_GAP;
    isolated.forEach((id, i) => nodes.push(place(id, (i % perRow) * COL, top + Math.floor(i / perRow) * ROW, -1)));
  }

  const pos = new Map(nodes.map((n) => [n.id, n]));
  const markers: MapLayout['markers'] = [];
  const links: MapLink[] = [];
  for (const c of chains) {
    const to = pos.get(c.conclusion);
    if (!to) continue;
    if (c.premises.length === 1) {
      const from = pos.get(c.premises[0] as string);
      if (from) links.push({ chainId: c.id, from: from.id, to: to.id, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
      continue;
    }
    const ys = c.premises.map((p) => pos.get(p)?.y ?? to.y);
    const mx = to.x - MARKER_OFFSET;
    const my = to.y * 0.7 + (ys.reduce((s, y) => s + y, 0) / ys.length) * 0.3;
    markers.push({ chainId: c.id, x: mx, y: my, premises: c.premises, conclusion: c.conclusion });
    for (const p of c.premises) {
      const from = pos.get(p);
      if (from) links.push({ chainId: c.id, from: p, to: c.conclusion, x1: from.x, y1: from.y, x2: mx, y2: my });
    }
    links.push({ chainId: c.id, from: c.conclusion, to: c.conclusion, x1: mx, y1: my, x2: to.x, y2: to.y });
  }

  const box = (list: PlacedMapNode[]) => {
    if (!list.length) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const xs = list.flatMap((n) => [n.x, n.label.x + n.label.width]);
    const ys = list.map((n) => n.y);
    return { minX: Math.min(...xs) - 20, minY: Math.min(...ys) - 20, maxX: Math.max(...xs) + 20, maxY: Math.max(...ys) + 20 };
  };
  const bounds = box(nodes);
  const joined = nodes.filter((n) => n.layer >= 0);
  return { nodes, markers, links, bounds, graphBounds: joined.length ? box(joined) : bounds };
}
