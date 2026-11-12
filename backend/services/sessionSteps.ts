/**
 * The step loop of a session (design §4): each idea's cards in turn, the grade of each answer, what it
 * counts as evidence, and where the step goes next (deeper, simpler, a prerequisite first, or done).
 */
import { FIGURE_STAGES, cardText, runTutorStep } from '../agents/tutor';
import type { Grade, LearnerResponse, TutorCard, TutorGoal, TutorStepInput } from '../agents/tutor';
import { SESSION_MAX_DEPTH, SIMPLE_AIM, cardBranches, certifyingStage, countedScore, emptyEdge, evidenceKindFor, followUp, isGraded, nextStage, normalizeEdge, stagesFor, testOutEdge } from '../core/session';
import type { EdgeState, FollowStep, Stage } from '../core/session';
import type { IdeaFinished } from '../core/cards';
import { PASS_SCORE } from '../core/types';
import type { Depth } from '../core/types';
import { CancelledError } from '../llm/provider';
import type { Database } from '../store/db';
import { afterAnswer } from './bugs';
import { secondsOnNode } from '../store/activity';
import { getState } from '../store/evidence';
import { appendSessionEvent, getSession, saveSessionState } from '../store/sessions';
import { creditRecalledCards } from './cards';
import { recordEvidence, setOwnStatement } from './evidence';
import { simplifyIdea } from './goals';
import { noteBackgroundGaps } from './remap';
import { startPractice } from './practice';
import type { LessonStep } from './planner';
import type { NodeHistoryEntry, SessionState, SessionDeps } from './sessionState';
import { hintsTaken, openAsides } from './sessionAsides';
import { figureImagesOf, imagesOf, buildTutorInput } from './sessionTutorInput';
import { premiseFor, pullIn } from './sessionPullIn';

const SESSION_PRACTICE_PROBLEMS = 2;

/**
 * Compound practice after the last idea (design §4.1 step 5): up to two problems over the goal's
 * fading ideas, not the ones just taught. A failed generation skips practice rather than the close.
 */
async function startSessionPractice(deps: SessionDeps, sessionId: string, state: SessionState): Promise<boolean> {
  if (state.practiceSetId !== undefined && state.practiceSetId !== null) return true;
  // a session the learner chose is about what they asked; a goal's fading ideas wait for its own sessions
  if (state.free || state.chosen || !state.goalId) return false;
  try {
    const set = await startPractice(deps, state.goalId, { sessionId, maxProblems: SESSION_PRACTICE_PROBLEMS, exclude: state.plan.steps.map((s) => s.nodeId) });
    state.practiceSetId = set?.id ?? null;
    if (set) appendSessionEvent(deps.db, sessionId, 'practice-start', { setId: set.id, problems: set.problems.length });
    return set !== null;
  } catch (error) {
    appendSessionEvent(deps.db, sessionId, 'practice-failed', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export async function beginStep(deps: SessionDeps, sessionId: string, state: SessionState, index: number, goal: TutorGoal, afterOutcome = false): Promise<void> {
  state.stepIndex = index;
  state.edge = emptyEdge();
  state.supportAfter = null;
  state.pendingEffort = null;
  const step = state.plan.steps[index];
  if (!step) {
    state.stage = null;
    state.card = null;
    state.owed = false;
    // saved as closing first: if the app quits while practice problems are written, the session reopens at its close
    state.phase = 'close';
    if (afterOutcome) saveSessionState(deps.db, sessionId, state);
    if (await startSessionPractice(deps, sessionId, state)) state.phase = 'practice';
    return;
  }
  state.phase = 'teach';
  state.nodeStatus[step.nodeId] = 'active';
  const resume = state.resume;
  if (resume && resume.nodeId === step.nodeId) {
    state.stage = resume.stage;
    state.card = resume.card;
    state.supportAfter = resume.supportAfter;
    state.edge = normalizeEdge(resume.edge);
    state.pendingEffort = resume.pendingEffort;
    state.history[step.nodeId] = resume.history;
    state.resume = null;
    state.owed = false;
    appendSessionEvent(deps.db, sessionId, 'resume', { nodeId: step.nodeId, stage: resume.stage, fromSessionId: resume.fromSessionId });
    return;
  }
  // back from a prerequisite pulled in for this idea: the question it was missing is asked afresh
  const back = state.pulledIn?.find((p) => p.for === step.nodeId && !p.returned);
  if (back) {
    back.returned = true;
    await produceCard(deps, sessionId, state, step, back.stage, null, goal, afterOutcome, true);
    return;
  }
  const first = stepStages(step)[0] as Stage;
  // the learner said they know it: the question that shows the aim decides, as with "test me" on a card
  if (state.testMe && canTestOut(step, first, state.edge)) {
    state.edge = testOutEdge(state.edge, first);
    await produceCard(deps, sessionId, state, step, certifyingStage(step.aim), null, goal, afterOutcome);
    return;
  }
  await produceCard(deps, sessionId, state, step, first, null, goal, afterOutcome);
}

/** The step loop for a step: fitted to its aim, from the depth it started at. */
export function stepStages(step: LessonStep): Stage[] {
  return stagesFor(step.aim, step.fromDepth);
}

/** Ask the tutor for the card of `stage` (grading `previous` in the same call when given) and show it. */
export async function produceCard(
  deps: SessionDeps,
  sessionId: string,
  state: SessionState,
  step: LessonStep,
  stage: Stage,
  previous: TutorStepInput['previous'],
  goal: TutorGoal,
  /**
   * True when an answer was already judged and written before this call. The session is then saved
   * first as owing this card, so a quit or a crash during the call reopens it at "the answer is saved,
   * the next card is not written yet" and never at the card that was answered (which would grade it twice).
   */
  afterOutcome = false,
  /** The card asks again, in a fresh version, a question the learner just missed. */
  retry = false,
): Promise<Grade | null> {
  // on failure, where the session stands if what came before this call is kept (see respondTo)
  const owe = (error: unknown): never => {
    state.stage = stage;
    state.card = null;
    throw error;
  };
  if (afterOutcome) {
    state.stage = stage;
    state.card = null;
    state.owed = true;
    saveSessionState(deps.db, sessionId, state);
  }
  // text written for a card that is not shown (another call writes the card) is not shown either
  deps.work.write(sessionId, '');
  const input = buildTutorInput(deps.db, state, step, previous, stage, goal);
  // a session opened with "test me" asks its first question cold: nothing about this idea was shown yet
  const cold = Boolean(state.testMe && state.edge.jumpedFrom && !previous && !(state.history[step.nodeId]?.length));
  const result = await runTutorStep(deps.provider, { ...input, images: previous ? imagesOf(deps, previous.response) : undefined, figureImages: FIGURE_STAGES.has(stage) ? figureImagesOf(deps, input.figures) : undefined, retry, testedCold: cold || undefined, onWriting: (text) => deps.work.write(sessionId, text) }).catch(owe);
  stillOpen(deps.db, sessionId);
  if (!result.card) return owe(new Error('the tutor returned no card'));
  showCard(deps, sessionId, state, step, stage, result.card);
  return result.grade;
}

/** Make `card` the open card of the step: in the history, the transcript (what explains) and the events. */
function showCard(deps: SessionDeps, sessionId: string, state: SessionState, step: LessonStep, stage: Stage, card: TutorCard): void {
  state.stage = stage;
  state.card = card;
  state.owed = false;
  pushHistory(state, step.nodeId, { stage, card, response: null, grade: null });
  if (card.stage === 'explain' || card.stage === 'support' || card.stage === 'reteach') state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: card.markdown });
  if (card.stage === 'index') state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: `${card.gist}\n\n${card.placement}` });
  appendSessionEvent(deps.db, sessionId, 'card', { nodeId: step.nodeId, stage, card });
}

/** The step as the rules after a grade see it. */
function followStep(step: LessonStep): FollowStep {
  return { aim: step.aim, stages: stepStages(step), minutes: step.minutes, simplified: step.simplified !== null };
}

export async function handleTeachResponse(deps: SessionDeps, sessionId: string, state: SessionState, response: LearnerResponse, goal: TutorGoal): Promise<void> {
  const { db } = deps;
  const step = state.plan.steps[state.stepIndex];
  const stage = state.stage;
  const card = state.card;
  if (!step || !stage || !card) throw new Error('no card to respond to');
  const stages = stepStages(step);

  // "I know this, test me": the question that shows the aim decides, with no explanation first
  if (response.testMe && canTestOut(step, stage, state.edge)) {
    state.edge = testOutEdge(state.edge, stage);
    finishHistory(state, step.nodeId, stage, response, null);
    await produceCard(deps, sessionId, state, step, certifyingStage(step.aim), null, goal);
    appendSessionEvent(db, sessionId, 'response', { nodeId: step.nodeId, stage, response });
    return;
  }

  if (!isGraded(stage)) {
    // explain / support / reteach: the learner read it; an effort rating may ride along to the next evidence
    if (response.effort !== undefined) state.pendingEffort = response.effort;
    finishHistory(state, step.nodeId, stage, response, null);
    appendSessionEvent(db, sessionId, 'response', { nodeId: step.nodeId, stage, response });
    const resumeFrom = stage === 'support' || stage === 'reteach' ? (state.supportAfter ?? stage) : stage;
    state.supportAfter = null;
    const next = nextStage(stages, resumeFrom, 'none');
    await advance(deps, sessionId, state, step, next, null, goal, true);
    return;
  }

  const previous = { stage, card, response };
  // an answer given with hints is not an unaided one: it counts for less, in the evidence and in what comes next
  const hints = hintsTaken(openAsides(db, sessionId, step.nodeId, stage));
  // the call that grades writes the card its grade leads to, so no card is written to be thrown away
  const branches = cardBranches(state.edge, followStep(step), stage, { confidence: response.confidence, hints, minutes: minutesOn(db, state, sessionId, step.nodeId) });
  const input = buildTutorInput(db, state, step, previous, null, goal);
  const explains = branches.some((b) => b.card && FIGURE_STAGES.has(b.card.stage));
  const result = await runTutorStep(deps.provider, { ...input, branches, images: imagesOf(deps, response), figureImages: explains ? figureImagesOf(deps, input.figures) : undefined, onWriting: (text) => deps.work.write(sessionId, text) });
  stillOpen(db, sessionId);
  const grade = result.grade;
  if (!grade) throw new Error('the tutor returned no grade');
  const counted = countedScore(grade.score, hints);
  finishHistory(state, step.nodeId, stage, response, grade);
  appendSessionEvent(db, sessionId, 'response', { nodeId: step.nodeId, stage, response, grade, ...(hints ? { hints } : {}) });
  writeOutcome(db, sessionId, state, step, stage, response, grade, counted, hints);
  // The answer is judged and written. From here on a quit or a crash must never bring the answered
  // card back: until the next card is shown, the session is saved as owing one.
  state.card = null;
  state.owed = true;
  saveSessionState(db, sessionId, state);

  // the idea's half hour (design §4.3); a missing foundation is also noted for the goal's map
  const missing = stage !== 'predict' && counted < PASS_SCORE && grade.missingBackground !== null;
  // a missing foundation that is on the map and learnable now is taught first, then the idea goes on (design §4.1)
  const premise = missing && grade.missingBackground ? premiseFor(db, state, step, grade.missingBackground.name) : null;
  if (premise) {
    pullIn(db, sessionId, state, step, premise, stage);
    await beginStep(deps, sessionId, state, state.stepIndex, goal, true);
    return;
  }
  // a chosen session's gaps are about what the learner asked, not about the goal's map
  if (missing && grade.missingBackground && state.goalId && !state.free) noteBackgroundGaps(db, state.goalId, [grade.missingBackground], 'session');
  const follow = followUp(state.edge, followStep(step), stage, { score: counted, confidence: response.confidence, missingBackground: missing, minutes: minutesOn(db, state, sessionId, step.nodeId) });
  state.edge = follow.edge;
  const written = result.card;
  if (follow.then === 'support' || follow.then === 'reteach') {
    state.supportAfter = stage;
  if (follow.then === 'support' && written && written.stage === 'support') showCard(deps, sessionId, state, step, 'support', written);
    else await produceCard(deps, sessionId, state, step, follow.then, null, goal, true);
    return;
  }
  if (follow.then === 'simplify') {
    const reason = missing && grade.missingBackground ? `It needs ${grade.missingBackground.name}, which this goal's time does not also cover` : 'It was taking longer than its half hour allows';
    simplifyStep(db, state, step, SIMPLE_AIM, reason);
    // start again from a plain explanation of the core idea; the loop goes on from there
    state.edge = { ...state.edge, consecutiveFailures: 0, jumpedFrom: null };
    await produceCard(deps, sessionId, state, step, 'explain', null, goal, true);
    return;
  }
  const next = follow.then;
  // the card the tutor wrote with its grade is the one to show: no second call
  if (next.stage !== null && written && written.stage === next.stage) {
    showCard(deps, sessionId, state, step, next.stage, written);
    return;
  }
  // a missed question comes once more in a fresh version (the feedback just said what was missing)
  if (next.retry && next.stage) {
    await produceCard(deps, sessionId, state, step, next.stage, null, goal, true, true);
    return;
  }
  await advance(deps, sessionId, state, step, next.stage, null, goal, true);
}

/** "I know this, test me" applies to a prediction or explanation with a deeper question still ahead. */
export function canTestOut(step: LessonStep, stage: Stage, edge: EdgeState): boolean {
  if (step.aim < 2 || edge.jumpedFrom || (stage !== 'predict' && stage !== 'explain')) return false;
  const stages = stepStages(step);
  return stages.indexOf(certifyingStage(step.aim)) > stages.indexOf(stage);
}

/** Minutes the learner has spent on this idea: in this session, plus what a carried-over idea had before. */
export function minutesOn(db: Database, state: SessionState, sessionId: string, nodeId: string): number {
  return secondsOnNode(db, [sessionId], nodeId) / 60 + (state.priorMinutes?.[nodeId] ?? 0);
}

/**
 * Simplify the step's idea for the goal (capped at `depth`, with the reason), and follow the caps
 * through the rest of today's plan: dependents planned deeper are capped to explaining.
 */
function simplifyStep(db: Database, state: SessionState, step: LessonStep, depth: Depth, reason: string, options: { dependents: boolean } = { dependents: true }): void {
  // a chosen session simplifies only itself: the goal's plan is the goal's sessions' business
  const changed = state.goalId && !state.free ? simplifyIdea(db, state.goalId, step.nodeId, depth, reason, options) : new Map<string, Depth>([[step.nodeId, depth]]);
  for (const st of state.plan.steps) {
    const cap = changed.get(st.nodeId);
    if (cap === undefined) continue;
    if (state.nodeStatus[st.nodeId] !== 'done') st.aim = Math.min(st.aim, cap) as Depth;
    st.simplified = st.simplified ?? (st.nodeId === step.nodeId ? reason : `Simplified with ${step.name}`);
  }
}

/**
 * Move to `next` within the node (producing its card) or finish the node and begin the next step. An
 * idea that ends below its aim (its half hour ran out, or it never came together) is kept at the depth
 * it reached and marked simplified, so the plan stops counting on more and the learner can go deeper later.
 */
async function advance(deps: SessionDeps, sessionId: string, state: SessionState, step: LessonStep, next: Stage | null, previous: TutorStepInput['previous'], goal: TutorGoal, afterOutcome = false): Promise<void> {
  if (next === null) {
    const reached = getState(deps.db, step.nodeId)?.depth ?? 0;
    // a session certifies up to applying; transfer comes from practice later, so it is never "missed" here.
    // The idea alone is held at what was reached: the ideas built on it are capped only when it had to be simplified.
    const asked = Math.min(step.aim, SESSION_MAX_DEPTH);
    if (asked >= 2 && reached < asked) {
      simplifyStep(deps.db, state, step, Math.max(1, reached) as Depth, `Learned to ${DEPTH_WORD[reached] ?? 'a first look'} within its half hour; the plan asked ${DEPTH_WORD[step.aim] ?? 'more'}`, { dependents: false });
    }
    state.nodeStatus[step.nodeId] = 'done';
    appendSessionEvent(deps.db, sessionId, 'node-done', { nodeId: step.nodeId });
    deps.onIdeaFinished?.(ideaFinished(sessionId, state, step));
    await beginStep(deps, sessionId, state, state.stepIndex + 1, goal, afterOutcome);
    return;
  }
  await produceCard(deps, sessionId, state, step, next, previous, goal, afterOutcome);
}

/** The session was ended while its work was running: nothing more is written to it. */
export function stillOpen(db: Database, sessionId: string): void {
  if (getSession(db, sessionId)?.status !== 'active') throw new CancelledError();
}

/** What the card writer reads about an idea the session just finished: what was taught and how the learner answered. */
function ideaFinished(sessionId: string, state: SessionState, step: LessonStep): IdeaFinished {
  return {
    sessionId,
    goalId: state.goalId,
    nodeId: step.nodeId,
    taught: state.transcript.filter((t) => t.nodeId === step.nodeId).map((t) => t.text),
    answers: (state.history[step.nodeId] ?? []).flatMap((h) => (h.response && isGraded(h.stage) ? [{ question: cardText(h.card), answer: h.response.answer, score: h.grade?.score ?? null }] : [])),
  };
}

const DEPTH_WORD = ['a first look', 'recognizing it', 'explaining it', 'deriving it', 'applying it', 'transferring it'];

function writeOutcome(db: Database, sessionId: string, state: SessionState, step: LessonStep, stage: Stage, response: LearnerResponse, grade: Grade, counted = grade.score, hints = 0): void {
  const kind = evidenceKindFor(stage);
  if (kind) {
    recordEvidence(db, {
      nodeId: step.nodeId,
      kind,
      score: counted,
      reasoning: grade.feedback,
      confidence: response.confidence ?? null,
      effort: state.pendingEffort ?? response.effort ?? null,
      sessionId,
      context: hints ? { step: stage, hints } : { step: stage },
    });
    state.pendingEffort = null;
  }
  if (stage === 'compress' && response.answer.trim()) setOwnStatement(db, step.nodeId, response.answer.trim(), response.handle?.trim() || null);
  if (stage === 'connect' && grade.score >= 0.7 && response.answer.trim()) {
    state.transcript.push({ nodeId: step.nodeId, nodeName: step.name, stage, text: `Link the learner stated and the tutor confirmed: ${response.answer.trim()}` });
  }
  afterAnswer(db, step.nodeId, grade.misconception ?? null);
  creditRecalledCards(db, grade.recalledCards, { source: 'session', sessionId });
}

function pushHistory(state: SessionState, nodeId: string, entry: NodeHistoryEntry): void {
  const list = state.history[nodeId] ?? [];
  list.push(entry);
  state.history[nodeId] = list;
}

function finishHistory(state: SessionState, nodeId: string, stage: Stage, response: LearnerResponse, grade: Grade | null): void {
  const list = state.history[nodeId] ?? [];
  const last = [...list].reverse().find((h) => h.stage === stage && h.response === null);
  if (last) {
    last.response = response;
    last.grade = grade;
  }
}
