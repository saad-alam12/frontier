/**
 * NodeState is derived from the evidence log. Depth is the highest level any passing piece of
 * evidence certifies, lowered a level when the learner clearly fails the idea in two sittings on
 * different days. The FSRS state is the fold of one review per sitting.
 */
import { applyReview, emptyFsrs } from './fsrs';
import type { Depth, Evidence, EvidenceKind, FsrsState } from './types';
import { PASS_SCORE } from './types';

/**
 * A sitting: answers on one idea that follow each other within this time. One sitting is one review,
 * however many steps it had; an answer after a longer break is a new recall and a new review.
 */
export const SITTING_GAP_MS = 4 * 3_600_000;
/** A sitting scored below this is a clear failure; between it and the pass mark it is a partial one. */
export const CLEAR_FAIL_SCORE = 0.4;
/** How hard a partial failure hits an idea that was reviewed before: half of a full lapse. */
const PARTIAL_FAIL_WEIGHT = 0.5;
/** Clear failures in this many sittings in a row, at least `DROP_APART_MS` apart, lower the depth one level. */
const FAILED_SITTINGS_TO_DROP = 2;
const DROP_APART_MS = 12 * 3_600_000;

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

/**
 * What a piece of evidence is to the review schedule.
 * - `direct`: the learner answered about this idea.
 * - `credit`: implicit credit from a passed task that used the idea. A failed task says nothing about
 *   which of its premises failed, so it gives none.
 * - `null`: not a recall. A prediction is made before the idea is taught, so missing it is expected;
 *   a lookup shows the answer.
 */
export function reviewRole(evidence: Evidence): 'direct' | 'credit' | null {
  if (evidence.kind === 'lookup') return null;
  if (evidence.context.implicit) return evidence.score >= PASS_SCORE ? 'credit' : null;
  if (evidence.kind === 'predict' && evidence.context.step === 'predict') return null;
  return 'direct';
}

export interface DerivedState {
  depth: Depth;
  fsrs: FsrsState;
  firstSessionId: string | null;
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * The fold behind a node's state: evidence in time order, one sitting open at a time. `depthIfClosed`
 * reads the depth as if the open sitting ended now, so the depth after each answer comes from one pass.
 */
class StateFold {
  depth: Depth = 0;
  fsrs = emptyFsrs();
  firstSessionId: string | null = null;
  /** When the clearly failed sittings in a row ended; a passed sitting empties it. */
  private failedAt: number[] = [];
  private sitting: Evidence[] = [];
  private previousAt: number | null = null;

  add(e: Evidence): void {
    if (!this.firstSessionId && e.sessionId) this.firstSessionId = e.sessionId;
    if (e.kind === 'lookup') return; // not part of any sitting
    const at = new Date(e.at).getTime();
    if (this.previousAt !== null && at - this.previousAt > SITTING_GAP_MS) this.close();
    this.previousAt = at;
    this.sitting.push(e);
    if (e.score >= PASS_SCORE) {
      const certified = certifiedDepth(e.kind, e.context);
      if (certified > this.depth) this.depth = certified;
    }
  }

  /** What closing the open sitting does to the depth: a second clear failure on another day drops it a level. */
  private failure(): { score: number; at: number; failedAt: number[] } | null {
    const direct = this.sitting.filter((e) => reviewRole(e) === 'direct');
    const last = direct[direct.length - 1];
    if (!last) return null;
    const score = mean(direct.map((e) => e.score));
    const at = new Date(last.at).getTime();
    if (score >= PASS_SCORE) return { score, at, failedAt: [] };
    if (score >= CLEAR_FAIL_SCORE || this.depth === 0) return { score, at, failedAt: this.failedAt };
    const previous = this.failedAt[this.failedAt.length - 1];
    // two failures in one day are one bad day, not two
    return { score, at, failedAt: previous === undefined || at - previous >= DROP_APART_MS ? [...this.failedAt, at] : this.failedAt };
  }

  depthIfClosed(): Depth {
    const failure = this.failure();
    return failure && failure.failedAt.length >= FAILED_SITTINGS_TO_DROP ? ((this.depth - 1) as Depth) : this.depth;
  }

  close(): void {
    const failure = this.failure();
    const credits = this.sitting.filter((e) => reviewRole(e) === 'credit');
    this.sitting = [];
    if (failure) {
      const partialFail = this.fsrs.lastReview !== null && failure.score >= CLEAR_FAIL_SCORE && failure.score < PASS_SCORE;
      this.fsrs = applyReview(this.fsrs, failure.score, new Date(failure.at), partialFail ? PARTIAL_FAIL_WEIGHT : 1);
      this.failedAt = failure.failedAt;
      if (this.failedAt.length >= FAILED_SITTINGS_TO_DROP) {
        this.depth = (this.depth - 1) as Depth;
        this.failedAt = [];
      }
      return;
    }
    const lastCredit = credits[credits.length - 1];
    // one credit per sitting, at the strongest link: three tasks that all used the idea are one light review
    if (lastCredit) this.fsrs = applyReview(this.fsrs, mean(credits.map((e) => e.score)), new Date(lastCredit.at), Math.max(...credits.map((e) => e.context.implicit?.weight ?? 0)));
  }
}

const inTimeOrder = (evidence: Evidence[]) => [...evidence].sort((a, b) => a.at.localeCompare(b.at));

export function deriveState(evidence: Evidence[]): DerivedState {
  const fold = new StateFold();
  for (const e of inTimeOrder(evidence)) fold.add(e);
  fold.close();
  return { depth: fold.depth, fsrs: fold.fsrs, firstSessionId: fold.firstSessionId };
}

/** The depth after each piece of evidence, in time order: what `deriveState` gives for each prefix, in one pass. */
export function depthsAlong(evidence: Evidence[]): { evidence: Evidence; depth: Depth }[] {
  const fold = new StateFold();
  return inTimeOrder(evidence).map((e) => {
    fold.add(e);
    return { evidence: e, depth: fold.depthIfClosed() };
  });
}
