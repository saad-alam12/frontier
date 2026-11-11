/**
 * Session mechanics (design §4): the step loop per idea, fitted to the depth the plan asks of it (its
 * aim) and to its half hour; the edge rules; and which evidence each stage produces. Pure; the session
 * service persists and calls the tutor.
 */
import type { EvidenceKind } from './types';
import { PASS_SCORE } from './types';

/** `support` is a worked example after repeated failures; `reteach` is the escalated fresh explanation after that. */
export type Stage = 'predict' | 'explain' | 'check' | 'derive' | 'connect' | 'compress' | 'use' | 'index' | 'support' | 'reteach';

/**
 * The stages for an idea, by its aim (the depth this session takes it to) and the depth it starts
 * from (design §4.2). The loop stops at the aim: an idea the plan asks to explain is never derived or
 * applied just because there is time. Recognizing is one index pass; deepening an idea the learner
 * already explains goes straight from a fresh explanation to the deeper check.
 */
export function stagesFor(aim: number, fromDepth = 0): Stage[] {
  if (aim <= 1) return ['index'];
  if (fromDepth >= 2) {
    const deeper: Stage[] = ['predict', 'explain'];
    if (aim >= 3 && fromDepth < 3) deeper.push('derive');
    if (aim >= 4) deeper.push('use');
    return deeper;
  }
  const stages: Stage[] = ['predict', 'explain', 'check'];
  if (aim >= 3) stages.push('derive', 'connect');
  stages.push('compress');
  if (aim >= 4) stages.push('use');
  return stages;
}

/** The deepest level a session's own steps certify (a `use` task: applying). Transfer is shown in practice, later. */
export const SESSION_MAX_DEPTH = 4;

/** The stage whose pass shows the aim is reached: what a test-out asks. */
export function certifyingStage(aim: number): Stage {
  if (aim <= 1) return 'index';
  if (aim === 2) return 'check';
  if (aim === 3) return 'derive';
  return 'use';
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
  /** Strong answers in a row (high score, and not a guess). */
  strongStreak: number;
  /** A worked example was already given for this idea. */
  supported?: boolean;
  /** The one escalation for this idea was already used. */
  escalated?: boolean;
  /** The learner jumped to the aim's question from this stage (a strong prediction, two strong answers, or "test me"). */
  jumpedFrom?: Stage | null;
  /** The idea had its half hour: one last step, then on. */
  wrapping?: boolean;
}

export const FAIL_SCORE = 0.5;
/** A strong answer: this score or more, given as at least fairly sure (or with no confidence). */
export const STRONG_SCORE = 0.85;
export const STRONG_CONFIDENCE = 0.66;
export const FAILURES_BEFORE_SUPPORT = 3;
export const STRONG_TO_CHECK_OFF = 2;

/**
 * - `testOut`: jump to the aim's question; `done`: the aim is shown, on to the next idea;
 * - `resume`: a test-out failed, so teach after all.
 */
export type EdgeAction = 'none' | 'support' | 'escalate' | 'testOut' | 'done' | 'resume';

export function emptyEdge(): EdgeState {
  return { consecutiveFailures: 0, strongStreak: 0 };
}

/** Saved states from before R3 counted easy answers instead of strong ones. */
export function normalizeEdge(edge: EdgeState & { easyStreak?: number }): EdgeState {
  return { ...edge, strongStreak: edge.strongStreak ?? 0 };
}

export function isStrong(score: number, confidence: number | undefined): boolean {
  return score >= STRONG_SCORE && (confidence === undefined || confidence >= STRONG_CONFIDENCE);
}

/**
 * Stay at the edge (design §4.3). Failing: three in a row bring a worked example; a failure after that
 * escalates once (a stronger model re-diagnoses and explains afresh). Knowing it: a strong prediction,
 * or two strong answers in a row, jump to the question that shows the aim (a test-out); passing that
 * question strongly, or as the second strong answer, checks the idea off. A failed test-out goes back
 * to teaching. Flags persist for the idea.
 */
export function applyGrade(edge: EdgeState, input: { score: number; confidence?: number; stage: Stage; aim: number }): { edge: EdgeState; action: EdgeAction } {
  const flags = { supported: edge.supported ?? false, escalated: edge.escalated ?? false, wrapping: edge.wrapping ?? false };
  const aimStage = certifyingStage(input.aim);
  if (edge.jumpedFrom && input.stage === aimStage && input.score < PASS_SCORE) {
    return { edge: { consecutiveFailures: input.score < FAIL_SCORE ? 1 : 0, strongStreak: 0, ...flags, jumpedFrom: edge.jumpedFrom }, action: 'resume' };
  }
  if (input.score < FAIL_SCORE) {
    if (flags.supported && !flags.escalated) return { edge: { consecutiveFailures: 0, strongStreak: 0, ...flags, escalated: true }, action: 'escalate' };
    const failures = edge.consecutiveFailures + 1;
    if (failures >= FAILURES_BEFORE_SUPPORT) return { edge: { consecutiveFailures: 0, strongStreak: 0, ...flags, supported: true }, action: 'support' };
    return { edge: { consecutiveFailures: failures, strongStreak: 0, ...flags }, action: 'none' };
  }
  const strong = isStrong(input.score, input.confidence);
  const streak = strong ? edge.strongStreak + 1 : 0;
  const next: EdgeState = { consecutiveFailures: 0, strongStreak: streak, ...flags, jumpedFrom: edge.jumpedFrom ?? null };
  if (input.stage === aimStage && strong && (streak >= STRONG_TO_CHECK_OFF || edge.jumpedFrom)) return { edge: next, action: 'done' };
  if (input.stage !== aimStage && strong && (input.stage === 'predict' || streak >= STRONG_TO_CHECK_OFF)) {
    return { edge: { ...next, jumpedFrom: input.stage }, action: 'testOut' };
  }
  return { edge: next, action: 'none' };
}

/** "Test me": the learner says they know it; the aim's question decides. */
export function testOutEdge(edge: EdgeState, from: Stage): EdgeState {
  return { ...edge, jumpedFrom: from };
}

/**
 * The stage after `current`, or null when the idea is finished. A test-out jumps to the aim's
 * question; a failed one resumes teaching where the jump left off (the explanation when it was
 * skipped); wrapping up goes to the learner's own words if they are still ahead, else ends.
 */
export function nextStage(stages: Stage[], current: Stage, action: EdgeAction | 'wrapUp', edge?: EdgeState, aim?: number): Stage | null {
  const i = stages.indexOf(current);
  if (action === 'done') return null;
  if (action === 'testOut' && aim !== undefined) {
    const target = certifyingStage(aim);
    return stages.indexOf(target) > i ? target : (stages[i + 1] ?? null);
  }
  if (action === 'resume' && edge?.jumpedFrom) {
    const from = stages.indexOf(edge.jumpedFrom);
    return stages[from + 1] ?? null;
  }
  if (action === 'wrapUp') {
    const compress = stages.indexOf('compress');
    return compress > i ? 'compress' : null;
  }
  return stages[i + 1] ?? null;
}

/** Teaching minutes an idea may take in a session, at most (design §4.3). */
export const IDEA_MAX_MINUTES = 30;
/** Struggling at this share of the allowance simplifies the idea. */
export const SIMPLIFY_AT = 0.6;
/** A simplified idea aims to be explained, at the intuition level. */
export const SIMPLE_AIM = 2;

/** The minutes an idea may take: what the plan priced it at for this learner, within 10–30. */
export function ideaAllowance(plannedMinutes: number): number {
  return Math.max(10, Math.min(IDEA_MAX_MINUTES, plannedMinutes));
}

export interface TimeboxInput {
  minutes: number;
  allowance: number;
  aim: number;
  simplified: boolean;
  edge: EdgeState;
  /** The tutor judged the last failure a missing prerequisite, not a slip. */
  missingBackground: boolean;
}

/**
 * The half hour per idea (design §4.3). When the time is up, wrap up. Before that, when the learner is
 * clearly missing what the idea needs (the tutor names a missing prerequisite, or they keep failing
 * well into the time), simplify: teach the core intuition the rest of the map needs, so something
 * usable is learned within the half hour.
 */
export function timebox(input: TimeboxInput): 'none' | 'simplify' | 'wrapUp' {
  if (input.minutes >= input.allowance) return 'wrapUp';
  if (input.aim <= 1 || input.simplified) return 'none';
  const struggling = input.edge.consecutiveFailures >= 2 || (input.edge.supported ?? false);
  if (input.missingBackground || (struggling && input.minutes >= SIMPLIFY_AT * input.allowance)) return 'simplify';
  return 'none';
}
