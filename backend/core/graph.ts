import type { Chain } from './types';

/** Adjacency views over chains. Built once per computation; cheap for graphs of a few thousand nodes. */
export interface GraphIndex {
  /** conclusion id → chains that conclude it */
  into: Map<string, Chain[]>;
  /** premise id → chains it appears in */
  outOf: Map<string, Chain[]>;
}

export function indexChains(chains: Iterable<Chain>): GraphIndex {
  const into = new Map<string, Chain[]>();
  const outOf = new Map<string, Chain[]>();
  for (const chain of chains) {
    push(into, chain.conclusion, chain);
    for (const p of chain.premises) push(outOf, p, chain);
  }
  return { into, outOf };
}

function push(map: Map<string, Chain[]>, key: string, chain: Chain): void {
  const list = map.get(key);
  if (list) list.push(chain);
  else map.set(key, [chain]);
}

/** Every node reachable upward through premises from `start` (not including start). */
export function ancestors(start: string, index: GraphIndex): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const chain of index.into.get(id) ?? []) {
      for (const p of chain.premises) {
        if (!seen.has(p) && p !== start) {
          seen.add(p);
          stack.push(p);
        }
      }
    }
  }
  return seen;
}

/** Nodes that depend on `start` (transitively), each with the decayed weight of its closest path. */
export function dependents(start: string, index: GraphIndex, decay: number, maxHops = Infinity): Map<string, number> {
  const best = new Map<string, number>();
  let frontier = [start];
  let weight = 1;
  let hops = 0;
  const visited = new Set<string>([start]);
  while (frontier.length && hops < maxHops) {
    hops += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const chain of index.outOf.get(id) ?? []) {
        const c = chain.conclusion;
        if (visited.has(c)) continue;
        visited.add(c);
        best.set(c, weight);
        next.push(c);
      }
    }
    frontier = next;
    weight *= decay;
  }
  return best;
}

/** Room kept for dependents; premises (what the idea is built on) get the rest first. */
const MAX_DOWN = 4;

/**
 * The ideas around `center`, nearest first: premises (upward) hop by hop, then dependents (downward),
 * with up to a third of the room (at most four) kept for dependents so both sides of the edge show. `include` nodes
 * (e.g. the rest of the lesson plan) come first. Ties break by id, so the same graph always gives the
 * same neighbourhood. Edges are the premise → conclusion links among the chosen nodes.
 */
export function neighbourhood(center: string, index: GraphIndex, limit: number, include: Iterable<string> = []): { nodeIds: string[]; edges: [string, string][] } {
  const chosen = new Set<string>([center]);
  for (const id of include) if (chosen.size < limit) chosen.add(id);
  const up = layers(center, (id) => (index.into.get(id) ?? []).flatMap((c) => c.premises));
  const down = layers(center, (id) => (index.outOf.get(id) ?? []).map((c) => c.conclusion));
  const downQuota = Math.min(down.filter((id) => !chosen.has(id)).length, Math.min(MAX_DOWN, Math.round(limit / 3)));
  for (const id of up) if (chosen.size < limit - downQuota) chosen.add(id);
  let downAdded = 0;
  for (const id of down) {
    if (downAdded >= downQuota || chosen.has(id)) continue;
    chosen.add(id);
    downAdded += 1;
  }
  for (const id of up) if (chosen.size < limit) chosen.add(id);
  const edges: [string, string][] = [];
  const seen = new Set<string>();
  for (const id of chosen) {
    for (const chain of index.into.get(id) ?? []) {
      for (const p of chain.premises) {
        const key = `${p}>${id}`;
        if (chosen.has(p) && !seen.has(key)) {
          seen.add(key);
          edges.push([p, id]);
        }
      }
    }
  }
  return { nodeIds: [...chosen], edges };
}

/** Breadth-first from `start` (excluded), each hop sorted by id. */
function layers(start: string, next: (id: string) => string[]): string[] {
  const seen = new Set<string>([start]);
  const out: string[] = [];
  let frontier = [start];
  while (frontier.length) {
    const layer = new Set<string>();
    for (const id of frontier) for (const n of next(id)) if (!seen.has(n)) layer.add(n);
    frontier = [...layer].sort();
    for (const id of frontier) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
