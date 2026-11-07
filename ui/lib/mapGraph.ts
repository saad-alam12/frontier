/**
 * The map as a graph (design §8): which ideas show under the filters, how ideas and chains become the
 * nodes and links of a force layout (a chain with several premises meets at a small junction before
 * its conclusion), each idea's layer (how far it sits from a root, for the "prerequisites left to
 * right" pull), neighbourhoods for hover and the local graph, idea sizes, and labels placed greedily
 * so they never overlap. Pure and deterministic: the canvas runs the simulation and draws.
 */
import type { MapNodeView, MapState, MapView } from '../../backend/api/contract';

export type ColorBy = 'state' | 'goal' | 'topic' | 'depth';

/** Everything the view panel sets; remembered between visits. */
export interface MapSettings {
  show: Record<MapState, boolean>;
  /** Only this goal: its targets and everything they are built on. */
  goalId: string | null;
  simplifiedOnly: boolean;
  /** Only ideas that have flashcards. */
  cardsOnly: boolean;
  /** Hide ideas no chain connects. */
  hideLoose: boolean;
  colorBy: ColorBy;
  /** Labels fade in from this zoom. */
  labelZoom: number;
  nodeSize: number;
  linkWidth: number;
  arrows: boolean;
  /** Forces, 0–1 except distance (world units). */
  center: number;
  repel: number;
  linkStrength: number;
  linkDistance: number;
  /** Pull prerequisites left and results right. */
  flow: boolean;
}

export const DEFAULT_SETTINGS: MapSettings = {
  show: { owned: true, fringe: true, beyond: true },
  goalId: null,
  simplifiedOnly: false,
  cardsOnly: false,
  hideLoose: false,
  colorBy: 'state',
  labelZoom: 0.9,
  nodeSize: 1,
  linkWidth: 1,
  arrows: false,
  center: 0.35,
  repel: 0.5,
  linkStrength: 0.6,
  linkDistance: 60,
  flow: false,
};

/** Read settings saved by an older version: unknown or missing fields fall back to the defaults. */
export function mergeSettings(saved: unknown): MapSettings {
  if (!saved || typeof saved !== 'object') return DEFAULT_SETTINGS;
  const s = saved as Partial<MapSettings>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    show: { ...DEFAULT_SETTINGS.show, ...(s.show ?? {}) },
    goalId: typeof s.goalId === 'string' ? s.goalId : null,
    simplifiedOnly: s.simplifiedOnly === true,
    cardsOnly: s.cardsOnly === true,
    hideLoose: s.hideLoose === true,
    colorBy: s.colorBy && ['state', 'goal', 'topic', 'depth'].includes(s.colorBy) ? s.colorBy : DEFAULT_SETTINGS.colorBy,
    labelZoom: num(s.labelZoom, DEFAULT_SETTINGS.labelZoom),
    nodeSize: num(s.nodeSize, DEFAULT_SETTINGS.nodeSize),
    linkWidth: num(s.linkWidth, DEFAULT_SETTINGS.linkWidth),
    arrows: s.arrows === true,
    center: num(s.center, DEFAULT_SETTINGS.center),
    repel: num(s.repel, DEFAULT_SETTINGS.repel),
    linkStrength: num(s.linkStrength, DEFAULT_SETTINGS.linkStrength),
    linkDistance: num(s.linkDistance, DEFAULT_SETTINGS.linkDistance),
    flow: s.flow === true,
  };
}

type Chains = MapView['chains'];

/** Undirected idea-to-idea adjacency through chains (a premise and its conclusion are neighbours). */
export function adjacency(chains: Chains): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    out.set(a, (out.get(a) ?? new Set()).add(b));
    out.set(b, (out.get(b) ?? new Set()).add(a));
  };
  for (const c of chains) for (const p of c.premises) link(p, c.conclusion);
  return out;
}

/** The idea and everything within `hops` steps of it along chains (Obsidian's local graph). */
export function neighbourhood(id: string, neighbours: Map<string, Set<string>>, hops: number): Set<string> {
  const seen = new Set([id]);
  let frontier = [id];
  for (let h = 0; h < hops; h += 1) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const m of neighbours.get(n) ?? []) {
        if (seen.has(m)) continue;
        seen.add(m);
        next.push(m);
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * The ideas shown: by state; for one goal, its targets and everything they are built on; only
 * simplified ones; only those with flashcards; without the loose ones; or only the neighbourhood of one idea.
 */
export function visibleIdeas(view: Pick<MapView, 'nodes' | 'chains'>, s: MapSettings, local: { id: string; hops: number } | null): Set<string> {
  const neighbours = adjacency(view.chains);
  let scope: Set<string> | null = null;
  if (s.goalId) {
    const into = new Map<string, string[]>();
    for (const c of view.chains) into.set(c.conclusion, [...(into.get(c.conclusion) ?? []), ...c.premises]);
    scope = new Set();
    const stack = view.nodes.filter((n) => s.goalId && n.goals.includes(s.goalId)).map((n) => n.id);
    while (stack.length) {
      const id = stack.pop() as string;
      if (scope.has(id)) continue;
      scope.add(id);
      stack.push(...(into.get(id) ?? []));
    }
  }
  const near = local ? neighbourhood(local.id, neighbours, local.hops) : null;
  const out = new Set<string>();
  for (const n of view.nodes) {
    if (near && !near.has(n.id)) continue;
    if (!near && !s.show[n.state]) continue;
    if (scope && !scope.has(n.id)) continue;
    if (s.simplifiedOnly && !n.simplified) continue;
    if (s.cardsOnly && n.cards === 0) continue;
    if (s.hideLoose && !neighbours.has(n.id)) continue;
    out.add(n.id);
  }
  return out;
}

export interface GraphNode {
  id: string;
  /** A chain's junction: where its premises meet before the conclusion. */
  junction: boolean;
  /** Distance from a root along the shortest derivation (junctions sit half a step before their conclusion). */
  layer: number;
  /** Ideas built directly on it: foundations draw larger. */
  dependents: number;
}

export interface GraphLink {
  source: string;
  target: string;
  /** The ideas at the two ends of the chain this segment belongs to, for highlighting. */
  from: string[];
  to: string;
}

export interface MapGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  neighbours: Map<string, Set<string>>;
}

const MAX_LAYER = 40;

/** The simulation's graph over the visible ideas. Chains keep only their visible premises. */
export function buildGraph(view: Pick<MapView, 'nodes' | 'chains'>, visible: Set<string>): MapGraph {
  const chains = view.chains
    .filter((c) => visible.has(c.conclusion))
    .map((c) => ({ ...c, premises: c.premises.filter((p) => visible.has(p) && p !== c.conclusion) }))
    .filter((c) => c.premises.length > 0);

  const layer = new Map<string, number>([...visible].map((id) => [id, 0]));
  const into = new Map<string, typeof chains>();
  for (const c of chains) into.set(c.conclusion, [...(into.get(c.conclusion) ?? []), c]);
  for (let round = 0; round < MAX_LAYER; round += 1) {
    let changed = false;
    for (const [conclusion, list] of into) {
      const next = Math.min(MAX_LAYER, Math.min(...list.map((c) => 1 + Math.max(...c.premises.map((p) => layer.get(p) ?? 0)))));
      if (next !== layer.get(conclusion)) {
        layer.set(conclusion, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const dependents = new Map<string, Set<string>>();
  for (const c of chains) for (const p of c.premises) dependents.set(p, (dependents.get(p) ?? new Set()).add(c.conclusion));
  const nodes: GraphNode[] = view.nodes.filter((n) => visible.has(n.id)).map((n) => ({ id: n.id, junction: false, layer: layer.get(n.id) ?? 0, dependents: dependents.get(n.id)?.size ?? 0 }));
  const links: GraphLink[] = [];
  for (const c of chains) {
    if (c.premises.length === 1) {
      links.push({ source: c.premises[0] as string, target: c.conclusion, from: c.premises, to: c.conclusion });
      continue;
    }
    const j = `junction:${c.id}`;
    nodes.push({ id: j, junction: true, layer: (layer.get(c.conclusion) ?? 1) - 0.5, dependents: 0 });
    for (const p of c.premises) links.push({ source: p, target: j, from: c.premises, to: c.conclusion });
    links.push({ source: j, target: c.conclusion, from: c.premises, to: c.conclusion });
  }
  return { nodes, links, neighbours: adjacency(chains) };
}

/** On-screen radius of an idea: foundations larger, deeper ideas you own a little larger. */
export function radiusOf(n: Pick<MapNodeView, 'state' | 'depth'>, dependents: number, size: number): number {
  return (3 + Math.sqrt(dependents) * 1.6 + (n.state === 'owned' ? n.depth * 0.35 : 0)) * size;
}

export interface LabelBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Higher goes first (selected, hovered, their neighbours, matches, then by importance). */
  priority: number;
}

const LABEL_PAD = 4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w + LABEL_PAD && b.x < a.x + a.w + LABEL_PAD && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Place labels greedily by priority; one that would overlap a placed label, leave the view, or run
 * under an overlay (the title, search, buttons, panels) is skipped.
 */
export function placeLabels(boxes: LabelBox[], width: number, height: number, blocked: Rect[] = []): LabelBox[] {
  const placed: LabelBox[] = [];
  const sorted = [...boxes].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const b of sorted) {
    if (b.x < 0 || b.y < 0 || b.x + b.w > width || b.y + b.h > height) continue;
    if (blocked.some((r) => overlaps(b, r)) || placed.some((p) => overlaps(b, p))) continue;
    placed.push(b);
  }
  return placed;
}

/** The order ideas appear in when the map replays how it grew: first learned first, the rest after. */
export function growthOrder(nodes: Pick<MapNodeView, 'id' | 'learnedAt'>[]): string[] {
  return [...nodes].sort((a, b) => (a.learnedAt ?? '￿').localeCompare(b.learnedAt ?? '￿') || a.id.localeCompare(b.id)).map((n) => n.id);
}

/** Canvas text has no KaTeX: drop math delimiters and commands to a readable approximation. */
export function plain(name: string): string {
  return name
    .replace(/\$/g, '')
    .replace(/\\(mathbf|mathrm|text|operatorname)\{([^}]*)\}/g, '$2')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '');
}
