/**
 * What carries from one session to the next on a goal: the ideas last finished (recalled first) and a
 * half-done idea, continued where it stopped.
 */
import type { Database } from '../store/db';
import { appendSessionEvent, listSessionEvents } from '../store/sessions';
import type { SessionRecord } from '../store/sessions';
import type { LessonPlan, LessonStep } from './planner';
import type { SessionState, ResumePoint } from './sessionState';

/** The finished ideas of the most recent ended session (done or ended early) that finished any. */
export function previouslyTaughtNodes(ended: SessionRecord<SessionState>[]): { id: string; name: string }[] {
  for (const session of ended) {
    const done = session.state.plan.steps.filter((s) => session.state.nodeStatus[s.nodeId] === 'done').map((s) => ({ id: s.nodeId, name: s.name }));
    if (done.length) return done;
  }
  return [];
}

/**
 * The half-done idea of a session that was ended early: the idea being taught when it ended, or one
 * it had carried over itself and not reached yet. Nothing carries once the idea is owned at its target depth.
 */
export function carriedPlace(session: SessionRecord<SessionState>, reached: (nodeId: string, targetDepth: number) => boolean): { step: LessonStep; resume: ResumePoint } | null {
  // a chosen session's half-done idea is not the goal's plan, so its planned sessions do not carry it
  if (session.status !== 'abandoned' || session.state.free || session.state.chosen) return null;
  const s = session.state;
  let resume: ResumePoint | null = null;
  const step = s.plan.steps[s.stepIndex];
  if (s.phase === 'teach' && step && s.stage && s.card) {
    resume = { nodeId: step.nodeId, fromSessionId: session.id, stage: s.stage, card: s.card, supportAfter: s.supportAfter, edge: s.edge, pendingEffort: s.pendingEffort, history: s.history[step.nodeId] ?? [] };
  } else if (s.resume) {
    resume = { ...s.resume, fromSessionId: session.id };
  }
  if (!resume) return null;
  const carriedStep = s.plan.steps.find((st) => st.nodeId === resume.nodeId);
  return carriedStep && !reached(carriedStep.nodeId, carriedStep.aim) ? { step: carriedStep, resume } : null;
}

/** The carried idea goes first; the planner's own pick of it is dropped. */
export function withCarriedStep(plan: LessonPlan, step: LessonStep): LessonPlan {
  const rest = plan.steps.filter((s) => s.nodeId !== step.nodeId).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== step.nodeId) }));
  const carried = { ...step, dependsOn: [] };
  if (plan.steps.length === 0) return { ...plan, title: `Continue: ${step.name}`, orientation: `Today picks up ${step.name} where you stopped.`, steps: [carried] };
  return { ...plan, steps: [carried, ...rest] };
}

/** Copy the carried idea's cards and answers into the new session so its history shows them. */
export function carryEvents(db: Database, fromSessionId: string, toSessionId: string, nodeId: string): void {
  for (const event of listSessionEvents(db, fromSessionId)) {
    if ((event.kind === 'card' || event.kind === 'response') && event.payload.nodeId === nodeId) {
      appendSessionEvent(db, toSessionId, event.kind, { ...event.payload, carriedFrom: fromSessionId });
    }
  }
}
