/**
 * Topics: groups of ideas that hang together through chains, for filtering Stats by domain. Label
 * propagation over the undirected chain graph: every idea starts as its own topic and repeatedly takes
 * the topic most of its neighbours have (ties to the smallest id), so it is deterministic. Each topic
 * is named after its most central idea; topics smaller than `minSize` are left out.
 */
import type { GraphIndex } from './graph';

export interface Topic {
  id: string;
  name: string;
  nodeIds: string[];
}

const ROUNDS = 12;

export function topics(nodeIds: string[], index: GraphIndex, names: Map<string, string>, centralityOf: (id: string) => number, minSize = 4): Topic[] {
  const known = new Set(nodeIds);
  const neighbours = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const chains of index.into.values()) {
    for (const c of chains) {
      if (!known.has(c.conclusion)) continue;
      for (const p of c.premises) {
        if (!known.has(p)) continue;
        neighbours.get(c.conclusion)?.push(p);
        neighbours.get(p)?.push(c.conclusion);
      }
    }
  }
  const label = new Map(nodeIds.map((id) => [id, id]));
  const order = [...nodeIds].sort();
  for (let round = 0; round < ROUNDS; round += 1) {
    let changed = false;
    for (const id of order) {
      const ns = neighbours.get(id) ?? [];
      if (!ns.length) continue;
      const counts = new Map<string, number>();
      for (const n of ns) {
        const l = label.get(n) as string;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
      if (best && best !== label.get(id) && (counts.get(best) ?? 0) > (counts.get(label.get(id) as string) ?? 0)) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const groups = new Map<string, string[]>();
  for (const id of order) groups.set(label.get(id) as string, [...(groups.get(label.get(id) as string) ?? []), id]);
  return [...groups.values()]
    .filter((ids) => ids.length >= minSize)
    .map((ids) => {
      const head = [...ids].sort((a, b) => centralityOf(b) - centralityOf(a) || a.localeCompare(b))[0] as string;
      return { id: `topic_${head}`, name: names.get(head) ?? head, nodeIds: ids };
    })
    .sort((a, b) => b.nodeIds.length - a.nodeIds.length || a.name.localeCompare(b.name));
}
