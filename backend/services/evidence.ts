/**
 * The evidence service: the only code that appends evidence, and the only code that writes
 * node_states (which are derived from evidence plus the learner's own text).
 */
import { logEvent } from '../store/activity';
import { implicitCreditWeights } from '../core/implicitCredit';
import { indexChains } from '../core/graph';
import { deriveState } from '../core/nodeState';
import type { Evidence, EvidenceContext, EvidenceKind, NodeState } from '../core/types';
import type { Database } from '../store/db';
import { nowIso, transaction } from '../store/db';
import { emptyState, getState, insertEvidence, listEvidenceForNode, upsertState } from '../store/evidence';
import { newId } from '../store/ids';
import { chainsAround, getNode } from '../store/world';

export interface EvidenceInput {
  nodeId: string;
  kind: EvidenceKind;
  /** 0–1. Use `normalizeGrade` for 0–10 grades. */
  score: number;
  reasoning: string;
  effort?: number | null;
  confidence?: number | null;
  context?: EvidenceContext;
  sessionId?: string | null;
  at?: string;
}

export function normalizeGrade(grade0to10: number): number {
  return Math.max(0, Math.min(1, grade0to10 / 10));
}

/** Append evidence, propagate implicit credit for use/practice, and refresh the derived states. */
export function recordEvidence(db: Database, input: EvidenceInput): { evidence: Evidence; implicit: Evidence[] } {
  return transaction(db, () => {
    if (!getNode(db, input.nodeId)) throw new Error(`unknown node ${input.nodeId}`);
    const evidence: Evidence = {
      id: newId('ev'),
      nodeId: input.nodeId,
      at: input.at ?? nowIso(),
      kind: input.kind,
      score: clamp01(input.score),
      reasoning: input.reasoning,
      effort: input.effort ?? null,
      confidence: input.confidence ?? null,
      context: input.context ?? {},
      sessionId: input.sessionId ?? null,
    };
    insertEvidence(db, evidence);
    const touched = new Set<string>([evidence.nodeId]);
    const implicit: Evidence[] = [];
    if ((evidence.kind === 'use' || evidence.kind === 'practice') && !evidence.context.implicit) {
      const index = indexChains(collectAncestryChains(db, evidence.nodeId));
      for (const [premiseId, { weight, hops }] of implicitCreditWeights(evidence.nodeId, index)) {
        const credit: Evidence = {
          ...evidence,
          id: newId('ev'),
          nodeId: premiseId,
          effort: null,
          confidence: null,
          reasoning: `Implicit credit from ${evidence.kind} of ${evidence.nodeId}`,
          context: { implicit: { fromNodeId: evidence.nodeId, fromEvidenceId: evidence.id, hops, weight } },
        };
        insertEvidence(db, credit);
        implicit.push(credit);
        touched.add(premiseId);
      }
    }
    for (const nodeId of touched) recomputeState(db, nodeId);
    return { evidence, implicit };
  });
}

/** Chains within two hops upward of a node (enough for implicit credit). */
function collectAncestryChains(db: Database, nodeId: string) {
  const chains = new Map<string, ReturnType<typeof chainsAround>[number]>();
  let frontier = [nodeId];
  for (let hop = 0; hop < 2 && frontier.length; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const chain of chainsAround(db, id)) {
        if (chain.conclusion !== id || chains.has(chain.id)) continue;
        chains.set(chain.id, chain);
        next.push(...chain.premises);
      }
    }
    frontier = next;
  }
  return [...chains.values()];
}

/** Recompute the derived fields of one node's state from its evidence; learner text and goal fields are kept. */
export function recomputeState(db: Database, nodeId: string): NodeState {
  const current = getState(db, nodeId) ?? emptyState(nodeId);
  const derived = deriveState(listEvidenceForNode(db, nodeId));
  const next: NodeState = { ...current, depth: derived.depth, fsrs: derived.fsrs, firstSessionId: current.firstSessionId ?? derived.firstSessionId };
  upsertState(db, next);
  if (next.depth !== current.depth) logEvent(db, 'depth.changed', { nodeId }, { from: current.depth, to: next.depth });
  return next;
}

export function setOwnStatement(db: Database, nodeId: string, ownStatement: string | null, handle?: string | null): NodeState {
  const current = getState(db, nodeId) ?? emptyState(nodeId);
  const next: NodeState = { ...current, ownStatement, handle: handle === undefined ? current.handle : handle };
  upsertState(db, next);
  return next;
}

/** Goal fields are written by the goal service through this one door. */
export function setGoalFields(db: Database, nodeId: string, targetDepth: NodeState['targetDepth'], tier: NodeState['tier']): void {
  const current = getState(db, nodeId) ?? emptyState(nodeId);
  if (current.targetDepth === targetDepth && current.tier === tier && getState(db, nodeId)) return;
  upsertState(db, { ...current, targetDepth, tier });
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
