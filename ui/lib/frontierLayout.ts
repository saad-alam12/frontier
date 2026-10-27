import type { FrontierMap, FrontierState } from '../../backend/api/contract';

/** Map canvas in its own units; the panel scales it to fit (labels are placed in percent). */
export const MAP_WIDTH = 460;
export const MAP_HEIGHT = 400;
/** The edge of knowledge: a dashed line between what is owned and what lies beyond (same curve as the mockup). */
export const EDGE_PATH = 'M300 0 C330 90 262 150 286 215 S338 330 296 400';

const PAD_Y = 40;
const CURRENT = { x: 244, y: 190 };
/** Horizontal bands by state: owned left of the edge line, the current idea on it, the rest beyond. */
const BAND: Record<FrontierState, [number, number]> = { owned: [36, 196], current: [244, 244], learnable: [310, 346], beyond: [384, 436] };

export interface PlacedNode {
  id: string;
  name: string;
  state: FrontierState;
  x: number;
  y: number;
}

/**
 * Deterministic layout: x from the node's state band (spread by hop distance from the current idea),
 * y from a few rounds of neighbour averaging seeded by a hash of the id. The same graph always gives
 * the same picture, so the map does not jump between steps.
 */
export function layoutFrontier(map: FrontierMap): PlacedNode[] {
  const hops = hopDistances(map);
  const neighbours = new Map<string, string[]>();
  for (const [a, b] of map.edges) {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  const byState = new Map<FrontierState, string[]>();
  for (const n of map.nodes) byState.set(n.state, [...(byState.get(n.state) ?? []), n.id]);

  const y = new Map<string, number>();
  for (const n of map.nodes) y.set(n.id, n.state === 'current' ? CURRENT.y : PAD_Y + (hash(n.id) % 1000) / 1000 * (MAP_HEIGHT - 2 * PAD_Y));
  for (let round = 0; round < 4; round += 1) {
    for (const [state, ids] of byState) {
      if (state === 'current') continue;
      const wanted = ids.map((id) => {
        const ns = neighbours.get(id) ?? [];
        const mean = ns.length ? ns.reduce((sum, nb) => sum + (y.get(nb) ?? CURRENT.y), 0) / ns.length : (y.get(id) ?? CURRENT.y);
        return { id, target: (mean + (y.get(id) ?? CURRENT.y)) / 2 };
      });
      wanted.sort((a, b) => a.target - b.target || a.id.localeCompare(b.id));
      const slot = (MAP_HEIGHT - 2 * PAD_Y) / Math.max(1, wanted.length);
      wanted.forEach((w, i) => y.set(w.id, PAD_Y + slot * (i + 0.5) + ((hash(w.id) % 21) - 10)));
    }
  }

  return map.nodes.map((n) => {
    const [lo, hi] = BAND[n.state];
    const h = hops.get(n.id) ?? 2;
    let x: number;
    if (n.state === 'owned') x = Math.max(lo, hi - (h - 1) * 64 - (hash(n.id) % 24));
    else if (n.state === 'current') x = CURRENT.x;
    else x = Math.min(hi, lo + (h - 1) * 16 + (hash(n.id) % 18));
    return { id: n.id, name: n.name, state: n.state, x, y: y.get(n.id) ?? CURRENT.y };
  });
}

function hopDistances(map: FrontierMap): Map<string, number> {
  const current = map.nodes.find((n) => n.state === 'current')?.id;
  const out = new Map<string, number>();
  if (!current) return out;
  const adj = new Map<string, string[]>();
  for (const [a, b] of map.edges) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  out.set(current, 0);
  let layer = [current];
  while (layer.length) {
    const next: string[] = [];
    for (const id of layer) {
      for (const nb of adj.get(id) ?? []) {
        if (out.has(nb)) continue;
        out.set(nb, (out.get(id) ?? 0) + 1);
        next.push(nb);
      }
    }
    layer = next;
  }
  return out;
}

/** FNV-1a: a small stable hash so positions never depend on render order. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
