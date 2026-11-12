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
  /** Questions of this idea already asked again after a miss; each is asked again once. */
  retried?: Stage[];
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
export type EdgeAction = 'none' | 'support' | 'escalate' | 'testOut' | 'done' | 'resume' | 'retry';

/** Questions that are asked again, once, in a fresh version when the learner misses them. */
export const RETRY_STAGES: ReadonlySet<Stage> = new Set<Stage>(['check', 'derive', 'use']);

/** Questions the learner can take a hint on, how many, and what an answer counts for with each. */
export const HINT_STAGES: ReadonlySet<Stage> = RETRY_STAGES;
export const MAX_HINTS = 2;
export const HINT_FACTOR = [1, 0.85, 0.7] as const;

/** What an answer counts for after the hints taken on its question: an aided answer is not an unaided one. */
export function countedScore(score: number, hints: number): number {
  return score * (HINT_FACTOR[Math.max(0, Math.min(MAX_HINTS, hints))] ?? 1);
}

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
 * to teaching. A missed prediction is no failure: it is made before the idea is taught. A missed
 * question (check, derive, use) is asked again once, in a fresh version, before the loop moves on.
 * Flags persist for the idea.
 */
export function applyGrade(edge: EdgeState, input: { score: number; confidence?: number; stage: Stage; aim: number }): { edge: EdgeState; action: EdgeAction } {
  const flags = { supported: edge.supported ?? false, escalated: edge.escalated ?? false, wrapping: edge.wrapping ?? false, retried: edge.retried ?? [] };
  const asksAgain = RETRY_STAGES.has(input.stage) && input.score < PASS_SCORE && !flags.retried.includes(input.stage);
  const again = { ...flags, retried: [...flags.retried, input.stage] };
  const aimStage = certifyingStage(input.aim);
  if (edge.jumpedFrom && input.stage === aimStage && input.score < PASS_SCORE) {
    return { edge: { consecutiveFailures: input.score < FAIL_SCORE ? 1 : 0, strongStreak: 0, ...flags, jumpedFrom: edge.jumpedFrom }, action: 'resume' };
  }
  // a prediction is a guess made before teaching: missing it is expected and counts toward nothing
  if (input.stage === 'predict' && input.score < FAIL_SCORE) return { edge: { consecutiveFailures: edge.consecutiveFailures, strongStreak: 0, ...flags }, action: 'none' };
  if (input.score < FAIL_SCORE) {
    if (flags.supported && !flags.escalated) return { edge: { consecutiveFailures: 0, strongStreak: 0, ...flags, escalated: true }, action: 'escalate' };
    const failures = edge.consecutiveFailures + 1;
    if (failures >= FAILURES_BEFORE_SUPPORT) return { edge: { consecutiveFailures: 0, strongStreak: 0, ...flags, supported: true }, action: 'support' };
    if (asksAgain) return { edge: { consecutiveFailures: failures, strongStreak: 0, ...again }, action: 'retry' };
    return { edge: { consecutiveFailures: failures, strongStreak: 0, ...flags }, action: 'none' };
  }
  // not a failure, not a pass: the feedback says what was missing, and the question comes once more
  if (asksAgain) return { edge: { consecutiveFailures: 0, strongStreak: 0, ...again, jumpedFrom: edge.jumpedFrom ?? null }, action: 'retry' };
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
  if (action === 'retry') return current;
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

/** What follows a graded answer: a worked example, the escalated re-teach, a simplified idea, or a stage (null: the idea is finished). */
export type FollowUp = 'support' | 'reteach' | 'simplify' | { stage: Stage | null; retry: boolean };

/** The step as the rules after a grade see it. */
export interface FollowStep {
  aim: number;
  /** The idea's stages for this session (`stagesFor`). */
  stages: Stage[];
  /** Minutes the plan prices the idea at. */
  minutes: number;
  simplified: boolean;
}

/**
 * Everything that decides what follows a graded answer (design §4.3), in one place: the edge rules,
 * the half hour per idea, a question asked again, wrapping up. The session uses it after a grade, and
 * before the call to tell the tutor which card each score leads to.
 */
export function followUp(edge: EdgeState, step: FollowStep, stage: Stage, input: { score: number; confidence?: number; missingBackground: boolean; minutes: number }): { edge: EdgeState; then: FollowUp } {
  const graded = applyGrade(edge, { score: input.score, confidence: input.confidence, stage, aim: step.aim });
  if (graded.action === 'support') return { edge: graded.edge, then: 'support' };
  if (graded.action === 'escalate') return { edge: graded.edge, then: 'reteach' };
  const box = graded.action === 'done' ? 'none' : timebox({ minutes: input.minutes, allowance: ideaAllowance(step.minutes), aim: step.aim, simplified: step.simplified, edge: graded.edge, missingBackground: input.missingBackground });
  if (box === 'simplify') return { edge: graded.edge, then: 'simplify' };
  const wrapped = box === 'wrapUp' ? { ...graded.edge, wrapping: true } : graded.edge;
  // a missed question comes once more in a fresh version, unless the idea's time is up
  if (graded.action === 'retry' && box === 'none') return { edge: wrapped, then: { stage, retry: true } };
  const next = box === 'wrapUp' ? nextStage(step.stages, stage, 'wrapUp') : nextStage(step.stages, stage, graded.action, graded.edge, step.aim);
  // a failed test-out goes back to teaching once; after that a miss on the same question is an ordinary miss
  return { edge: graded.action === 'resume' ? { ...wrapped, jumpedFrom: null } : wrapped, then: { stage: next, retry: false } };
}

/** The card a tutor call can write with its grade: a stage of the idea (perhaps asked again), or none. */
export interface CardBranch {
  /** The tutor's score from here (inclusive)… */
  from: number;
  /** …to here (exclusive; null: up to 1). */
  below: number | null;
  card: { stage: Stage; retry: boolean } | null;
}

/** Cards a tutor call can write together with a grade; the escalated re-teach and a simplified idea need calls of their own. */
const IN_CALL: ReadonlySet<Stage> = new Set<Stage>(['predict', 'explain', 'check', 'derive', 'connect', 'compress', 'use', 'index', 'support']);

/**
 * Which card follows each score the tutor may give, so the call that grades an answer writes the card
 * that will be shown and none is written to be thrown away (design §4.3). Scores are tried every
 * hundredth, as the tutor gives them (before hints lower them), and runs of the same card become one
 * band. A band whose follow-up needs a call of its own (the re-teach, a simplified idea, the next idea)
 * gets no card. Assumes no missing background: when the tutor names one, the session asks again.
 */
export function cardBranches(edge: EdgeState, step: FollowStep, stage: Stage, input: { confidence?: number; hints: number; minutes: number }): CardBranch[] {
  const bands: CardBranch[] = [];
  for (let i = 0; i <= 100; i += 1) {
    const score = i / 100;
    const { then } = followUp(edge, step, stage, { score: countedScore(score, input.hints), confidence: input.confidence, missingBackground: false, minutes: input.minutes });
    const card = then === 'support' ? { stage: 'support' as Stage, retry: false } : typeof then === 'object' && then.stage && IN_CALL.has(then.stage) ? { stage: then.stage, retry: then.retry } : null;
    const last = bands[bands.length - 1];
    if (last && sameCard(last.card, card)) continue;
    if (last) last.below = score;
    bands.push({ from: score, below: null, card });
  }
  return bands;
}

function sameCard(a: CardBranch['card'], b: CardBranch['card']): boolean {
  return a === null || b === null ? a === b : a.stage === b.stage && a.retry === b.retry;
}
