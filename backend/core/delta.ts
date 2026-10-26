/**
 * Delta classification (design §7.5): what a source means for this learner.
 */
import type { Depth, NodeState } from './types';
import { OWNED_DEPTH } from './types';

export type DeltaClass = 'known' | 'deeper' | 'new-fringe' | 'new-beyond' | 'conflict';

export interface DeltaInput {
  nodeIds: string[];
  states: Map<string, NodeState>;
  owned: Set<string>;
  fringe: Set<string>;
  targetDepths: Map<string, Depth>;
  conflicts: Set<string>;
}

export interface DeltaView {
  counts: Record<DeltaClass, number>;
  classes: Map<string, DeltaClass>;
}

export function classifyDelta(input: DeltaInput): DeltaView {
  const classes = new Map<string, DeltaClass>();
  const counts: Record<DeltaClass, number> = { known: 0, deeper: 0, 'new-fringe': 0, 'new-beyond': 0, conflict: 0 };
  for (const id of input.nodeIds) {
    let cls: DeltaClass;
    if (input.conflicts.has(id)) cls = 'conflict';
    else if (input.owned.has(id)) {
      const target = Math.max(input.targetDepths.get(id) ?? 0, OWNED_DEPTH);
      cls = (input.states.get(id)?.depth ?? 0) >= target ? 'known' : 'deeper';
    } else cls = input.fringe.has(id) ? 'new-fringe' : 'new-beyond';
    classes.set(id, cls);
    counts[cls] += 1;
  }
  return { counts, classes };
}
