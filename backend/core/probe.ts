/**
 * Probe mechanics (design §3.4): which nodes carry the most information, and what a good answer implies.
 */
import { dependents } from './graph';
import type { GraphIndex } from './graph';
import { PASS_SCORE } from './types';

/** Rank target nodes by how many other targets depend on them (transitively, decayed), ties by id. */
/** Ideas in `first` (those the learner says they know the material of, R8 E1) come before the rest, so the probe checks them first. */
export function rankByInformation(targetIds: Iterable<string>, index: GraphIndex, first: ReadonlySet<string> = new Set()): { nodeId: string; information: number }[] {
  const targets = new Set(targetIds);
  const ranked: { nodeId: string; information: number }[] = [];
  for (const id of targets) {
    let info = 0;
    for (const [dep, weight] of dependents(id, index, 0.5)) if (targets.has(dep)) info += weight;
    ranked.push({ nodeId: id, information: info });
  }
  return ranked.sort((a, b) => Number(first.has(b.nodeId)) - Number(first.has(a.nodeId)) || b.information - a.information || a.nodeId.localeCompare(b.nodeId));
}

export const IMPLIED_PREMISE_FACTOR = 0.9;

/** A good derivation of a node implies its direct premises at a lower depth: same score, slightly discounted. */
export function impliedPremiseScores(nodeId: string, score: number, kind: 'check' | 'derive' | 'use', index: GraphIndex): Map<string, number> {
  const out = new Map<string, number>();
  if (kind === 'check' || score < PASS_SCORE) return out;
  for (const chain of index.into.get(nodeId) ?? []) {
    for (const p of chain.premises) {
      const s = score * IMPLIED_PREMISE_FACTOR;
      if ((out.get(p) ?? 0) < s) out.set(p, s);
    }
  }
  return out;
}
