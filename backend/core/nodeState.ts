/**
 * NodeState is derived from the evidence log. Depth is the highest level any passing piece of
 * evidence certifies; the FSRS state is the fold of all reviews in time order.
 */
import { applyReview, emptyFsrs } from './fsrs';
import type { Depth, Evidence, EvidenceKind, FsrsState } from './types';
import { PASS_SCORE } from './types';

/** How much the learner looking something up counts as a review. */
const LOOKUP_WEIGHT = 0.2;

/** The depth a passing piece of evidence certifies (design §2.3). Implicit credit certifies nothing. */
export function certifiedDepth(kind: EvidenceKind, context: Evidence['context']): Depth {
  if (context.implicit) return 0;
  switch (kind) {
    case 'lookup':
    case 'predict':
      return 1;
    case 'recall':
    case 'check':
    case 'explain':
      return 2;
    case 'derive':
      return 3;
    case 'use':
      return 4;
    case 'practice': {
      const rung = context.rung ?? 2;
      if (rung >= 4) return 5;
      if (rung >= 2) return 4;
      return 2;
    }
  }
}

export function reviewWeight(evidence: Evidence): number {
  if (evidence.context.implicit) return evidence.context.implicit.weight;
  if (evidence.kind === 'lookup') return LOOKUP_WEIGHT;
  return 1;
}

export interface DerivedState {
  depth: Depth;
  fsrs: FsrsState;
  firstSessionId: string | null;
}

export function deriveState(evidence: Evidence[]): DerivedState {
  const ordered = [...evidence].sort((a, b) => a.at.localeCompare(b.at));
  let depth: Depth = 0;
  let fsrs = emptyFsrs();
  let firstSessionId: string | null = null;
  for (const e of ordered) {
    if (e.score >= PASS_SCORE) {
      const certified = certifiedDepth(e.kind, e.context);
      if (certified > depth) depth = certified;
    }
    fsrs = applyReview(fsrs, e.score, new Date(e.at), reviewWeight(e));
    if (!firstSessionId && e.sessionId) firstSessionId = e.sessionId;
  }
  return { depth, fsrs, firstSessionId };
}
