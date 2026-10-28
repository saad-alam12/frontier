/**
 * The derivation path (design §8): how an idea is reached from what the learner already owns.
 * Walk premises upward, at each idea taking the chain that needs the fewest unowned ideas, and stop
 * at owned ideas and roots. The steps come back in teaching order: grounds first, the idea last.
 */
import type { GraphIndex } from './graph';

export interface DerivationStep {
  nodeId: string;
  /** The premises of the chain used to reach this idea; empty for an owned idea or a root. */
  premises: string[];
  /** Owned ideas are where the path is grounded. */
  owned: boolean;
}

export function derivationPath(nodeId: string, index: GraphIndex, owned: Set<string>, maxSteps = 24): DerivationStep[] {
  const memo = new Map<string, number>();
  /** Unowned ideas needed to reach `id`, through its cheapest chain (cycles count as unreachable). */
  const cost = (id: string, stack: Set<string>): number => {
    if (owned.has(id)) return 0;
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return Infinity;
    const chains = index.into.get(id) ?? [];
    if (chains.length === 0) return 1;
    stack.add(id);
    let best = Infinity;
    for (const c of chains) best = Math.min(best, 1 + c.premises.reduce((s, p) => s + cost(p, stack), 0));
    stack.delete(id);
    memo.set(id, best);
    return best;
  };
  const chosen = (id: string): string[] => {
    if (owned.has(id)) return [];
    const chains = index.into.get(id) ?? [];
    let best: string[] = [];
    let bestCost = Infinity;
    for (const c of chains) {
      const total = c.premises.reduce((s, p) => s + cost(p, new Set([id])), 0);
      if (total < bestCost || (total === bestCost && c.premises.length < best.length)) {
        best = c.premises;
        bestCost = total;
      }
    }
    return best;
  };
  const out: DerivationStep[] = [];
  const placed = new Set<string>();
  const visit = (id: string, stack: Set<string>) => {
    if (placed.has(id) || stack.has(id) || out.length >= maxSteps) return;
    stack.add(id);
    const premises = chosen(id);
    for (const p of premises) visit(p, stack);
    stack.delete(id);
    if (placed.has(id)) return;
    placed.add(id);
    out.push({ nodeId: id, premises, owned: owned.has(id) });
  };
  visit(nodeId, new Set());
  return out;
}
