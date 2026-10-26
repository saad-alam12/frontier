/**
 * Lesson planning mechanics (design §4.1 step 3): the candidate set is everything reachable from the
 * fringe toward the targets, in dependency layers. The planner agent only chooses among these.
 */
import { ancestors } from './graph';
import type { GraphIndex } from './graph';

export interface PlanCandidate {
  nodeId: string;
  /** 0 for nodes on the fringe now, 1 for nodes unlocked by layer 0, and so on. */
  layer: number;
  /** Premises (of the chain that unlocks it) that are candidates rather than owned. */
  dependsOn: string[];
  onFringe: boolean;
}

/**
 * Walk from the fringe toward the targets: a node joins the candidate set once some chain into it
 * has all premises owned or already candidates. Only nodes relevant to the targets (the targets and
 * their ancestry) are considered. Returns candidates ordered by layer, then id.
 */
export function planCandidates(targetIds: Iterable<string>, owned: Set<string>, fringe: Set<string>, index: GraphIndex): PlanCandidate[] {
  const relevant = new Set<string>();
  for (const t of targetIds) {
    if (owned.has(t)) continue;
    relevant.add(t);
    for (const a of ancestors(t, index)) if (!owned.has(a)) relevant.add(a);
  }
  const candidates = new Map<string, PlanCandidate>();
  let layer = 0;
  let added = [...fringe].filter((id) => relevant.has(id)).sort();
  for (const id of added) candidates.set(id, { nodeId: id, layer, dependsOn: [], onFringe: true });
  while (added.length) {
    layer += 1;
    const next: string[] = [];
    for (const id of relevant) {
      if (candidates.has(id)) continue;
      const chains = index.into.get(id) ?? [];
      const unlocking = chains.find((c) => c.premises.every((p) => owned.has(p) || candidates.has(p)));
      if (!unlocking) continue;
      next.push(id);
      candidates.set(id, { nodeId: id, layer, dependsOn: unlocking.premises.filter((p) => candidates.has(p)), onFringe: false });
    }
    next.sort();
    added = next;
  }
  return [...candidates.values()].sort((a, b) => a.layer - b.layer || a.nodeId.localeCompare(b.nodeId));
}

/**
 * Order chosen nodes so every node comes after the chosen nodes it depends on, also through
 * candidates that were not chosen (stable for ties).
 */
export function orderByDependencies(chosen: string[], candidates: Map<string, PlanCandidate>): string[] {
  const chosenSet = new Set(chosen);
  const visited = new Set<string>();
  const out: string[] = [];
  const visit = (id: string, stack: Set<string>) => {
    if (visited.has(id) || stack.has(id)) return;
    stack.add(id);
    for (const dep of candidates.get(id)?.dependsOn ?? []) visit(dep, stack);
    stack.delete(id);
    visited.add(id);
    if (chosenSet.has(id)) out.push(id);
  };
  for (const id of chosen) visit(id, new Set());
  return out;
}
