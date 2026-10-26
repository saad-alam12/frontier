/**
 * Implicit credit (design §2.5): a use of a node pays partial review credit to its premises along
 * chains, decaying per hop. Returns the weight each premise receives (the best path wins).
 */
import type { GraphIndex } from './graph';

export const IMPLICIT_FACTOR = 0.5;
export const IMPLICIT_MAX_HOPS = 2;

export function implicitCreditWeights(
  nodeId: string,
  index: GraphIndex,
  options: { factor?: number; maxHops?: number } = {},
): Map<string, { weight: number; hops: number }> {
  const factor = options.factor ?? IMPLICIT_FACTOR;
  const maxHops = options.maxHops ?? IMPLICIT_MAX_HOPS;
  const result = new Map<string, { weight: number; hops: number }>();
  let frontier = [nodeId];
  const visited = new Set<string>([nodeId]);
  for (let hop = 1; hop <= maxHops && frontier.length; hop += 1) {
    const weight = factor ** hop;
    const next: string[] = [];
    for (const id of frontier) {
      for (const chain of index.into.get(id) ?? []) {
        for (const p of chain.premises) {
          if (visited.has(p)) continue;
          visited.add(p);
          result.set(p, { weight, hops: hop });
          next.push(p);
        }
      }
    }
    frontier = next;
  }
  return result;
}
