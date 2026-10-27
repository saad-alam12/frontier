/**
 * Ownership and the fringe (design §2.4). Computed in code, never by the model.
 */
import { recallProbability } from './fsrs';
import type { GraphIndex } from './graph';
import type { KnowledgeNode, NodeState } from './types';
import { OWNED_DEPTH, OWNED_RECALL } from './types';

export function isOwned(state: NodeState | undefined, now: Date): boolean {
  if (!state) return false;
  return state.depth >= OWNED_DEPTH && recallProbability(state.fsrs, now) >= OWNED_RECALL;
}

export function ownedSet(states: Iterable<NodeState>, now: Date): Set<string> {
  const owned = new Set<string>();
  for (const s of states) if (isOwned(s, now)) owned.add(s.nodeId);
  return owned;
}

export interface FringeInput {
  nodes: Iterable<KnowledgeNode>;
  index: GraphIndex;
  owned: Set<string>;
}

/**
 * Nodes not owned that are learnable now: a root (no chains into it: a definition, a basic claim or
 * procedure) always is; any other node is once some chain into it has every premise owned.
 */
export function computeFringe({ nodes, index, owned }: FringeInput): Set<string> {
  const fringe = new Set<string>();
  for (const node of nodes) {
    if (owned.has(node.id)) continue;
    const chains = index.into.get(node.id) ?? [];
    if (chains.length === 0 || chains.some((c) => c.premises.every((p) => owned.has(p)))) fringe.add(node.id);
  }
  return fringe;
}
