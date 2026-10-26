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
