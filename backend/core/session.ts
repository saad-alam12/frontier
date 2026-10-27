/**
 * Session mechanics (design §4): the step loop per node, the edge rules, and which evidence each
 * stage produces. Pure; the session service persists and calls the tutor.
 */
import type { EvidenceKind } from './types';

export type StepMode = 'teach' | 'index' | 'derive';

/** `support` is a worked example after repeated failures; `reteach` is the escalated fresh explanation after that. */
export type Stage = 'predict' | 'explain' | 'check' | 'derive' | 'connect' | 'compress' | 'use' | 'index' | 'support' | 'reteach';

/** The ordered stages of the step loop for a node, by its mode (design §4.2). */
export function stagesFor(mode: StepMode): Stage[] {
  if (mode === 'index') return ['index'];
  const stages: Stage[] = ['predict', 'explain', 'check'];
  if (mode === 'derive') stages.push('derive');
  stages.push('connect', 'compress', 'use');
  return stages;
}

/** Stages that end with the learner answering something the tutor grades. */
export function isGraded(stage: Stage): boolean {
  return stage !== 'explain' && stage !== 'support' && stage !== 'reteach';
}

/** Which evidence a graded stage writes. Connect links feed the transcript instead of evidence. */
export function evidenceKindFor(stage: Stage): EvidenceKind | null {
  switch (stage) {
    case 'predict':
      return 'predict';
    case 'check':
      return 'check';
    case 'derive':
      return 'derive';
    case 'use':
      return 'use';
    case 'compress':
      return 'explain';
    case 'index':
      return 'predict';
    default:
      return null;
  }
}

export interface EdgeState {
  consecutiveFailures: number;
  easyStreak: number;
  /** A worked example was already given for this idea. */
  supported?: boolean;
  /** The one escalation for this idea was already used. */
  escalated?: boolean;
}

export const FAIL_SCORE = 0.5;
export const EASY_SCORE = 0.9;
export const FAILURES_BEFORE_SUPPORT = 3;
export const EASY_BEFORE_SKIP = 2;

export type EdgeAction = 'none' | 'support' | 'escalate' | 'skipAhead';

export function emptyEdge(): EdgeState {
  return { consecutiveFailures: 0, easyStreak: 0 };
}

/**
 * Stay at the edge (design §4.3): three failures in a row drop a level (a worked example); a failure
 * after that worked example escalates once (a stronger model re-diagnoses and explains afresh);
 * repeated easy successes skip ahead to the compress step. Flags persist for the idea.
 */
export function applyGrade(edge: EdgeState, score: number): { edge: EdgeState; action: EdgeAction } {
  const flags = { supported: edge.supported ?? false, escalated: edge.escalated ?? false };
  if (score < FAIL_SCORE) {
    if (flags.supported && !flags.escalated) return { edge: { consecutiveFailures: 0, easyStreak: 0, supported: true, escalated: true }, action: 'escalate' };
    const failures = edge.consecutiveFailures + 1;
    if (failures >= FAILURES_BEFORE_SUPPORT) return { edge: { consecutiveFailures: 0, easyStreak: 0, ...flags, supported: true }, action: 'support' };
    return { edge: { consecutiveFailures: failures, easyStreak: 0, ...flags }, action: 'none' };
  }
  if (score >= EASY_SCORE) {
    const streak = edge.easyStreak + 1;
    if (streak >= EASY_BEFORE_SKIP) return { edge: { consecutiveFailures: 0, easyStreak: 0, ...flags }, action: 'skipAhead' };
    return { edge: { consecutiveFailures: 0, easyStreak: streak, ...flags }, action: 'none' };
  }
  return { edge: { consecutiveFailures: 0, easyStreak: 0, ...flags }, action: 'none' };
}

/** The stage after `current`, or null when the node is finished. Skipping ahead jumps to compress. */
export function nextStage(stages: Stage[], current: Stage, action: EdgeAction): Stage | null {
  const i = stages.indexOf(current);
  if (action === 'skipAhead') {
    const compress = stages.indexOf('compress');
    if (compress > i) return 'compress';
  }
  return stages[i + 1] ?? null;
}
