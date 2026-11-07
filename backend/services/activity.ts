/**
 * Active time (design §10.2). The renderer ticks every few seconds while the learner is at the window
 * and has done something recently; the tick is attributed here to what they are doing: the session's
 * goal and current idea, the practice set's goal, the probe's goal, or just the screen.
 */
import type { Database } from '../store/db';
import type { Surface } from '../store/activity';
import { logTime } from '../store/activity';
import { getPracticeSet, listProblems, answerFor } from '../store/practice';
import { activeSession } from '../store/sessions';
import type { SessionState } from './session';

export interface TickInput {
  /** The screen; the backend decides whether session time is free study. */
  surface: Exclude<Surface, 'free'>;
  seconds: number;
  goalId?: string | null;
  practiceSetId?: string | null;
}

/** The longest tick honoured: a renderer that stalled does not book the stall as study. */
const MAX_TICK_SECONDS = 60;

export function tick(db: Database, input: TickInput, now = new Date()): void {
  const seconds = Math.max(0, Math.min(MAX_TICK_SECONDS, input.seconds));
  if (!seconds) return;
  if (input.surface === 'session') {
    const session = activeSession<SessionState>(db);
    if (!session) return;
    const state = session.state;
    const step = state.phase === 'teach' ? state.plan.steps[state.stepIndex] : undefined;
    // a chosen session not counted toward a goal is free study: no goal's time, also not through its ideas
    const surface = state.free && session.goalId === null ? 'free' : 'session';
    logTime(db, surface, { goalId: session.goalId, sessionId: session.id, nodeId: step?.nodeId ?? null, practiceSetId: state.practiceSetId ?? null }, seconds, now);
    return;
  }
  if (input.surface === 'practice' && input.practiceSetId) {
    const set = getPracticeSet(db, input.practiceSetId);
    if (!set) return;
    const open = listProblems(db, set.id).find((p) => !answerFor(db, p.id));
    // a problem drawing on one idea books the time to it; a composition books it to the goal
    const nodeId = open && open.nodeIds.length === 1 ? (open.nodeIds[0] ?? null) : null;
    logTime(db, 'practice', { goalId: set.goalId, practiceSetId: set.id, sessionId: set.sessionId, nodeId }, seconds, now);
    return;
  }
  logTime(db, input.surface, { goalId: input.goalId ?? null }, seconds, now);
}
