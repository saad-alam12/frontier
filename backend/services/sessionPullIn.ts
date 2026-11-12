/**
 * A missing prerequisite the tutor names is pulled into the session and taught first (design §4); the
 * idea it was for comes back at the question it missed.
 */
import { SIMPLE_AIM } from '../core/session';
import type { Stage } from '../core/session';
import type { Depth } from '../core/types';
import type { Database } from '../store/db';
import { appendSessionEvent } from '../store/sessions';
import { loadKnowledge } from './knowledge';
import { stepMinutes } from './planner';
import { learnerSpeedNow } from './budget';
import { premiseToPullIn } from '../core/pullIn';
import type { LessonStep } from './planner';
import type { SessionState } from './sessionState';

/** Prerequisites a session pulls in at most, and never two for the same idea. */
const MAX_PULLS = 2;

/**
 * The prerequisite to pull in for a gap the tutor named: one of the ideas this one is built on, nearest
 * first, that is learnable now and not already in today's plan (core/pullIn.ts). Null when there is none.
 */
export function premiseFor(db: Database, state: SessionState, step: LessonStep, gap: string): LessonStep | null {
  const pulls = state.pulledIn ?? [];
  if (pulls.length >= MAX_PULLS || pulls.some((p) => p.for === step.nodeId || p.nodeId === step.nodeId)) return null;
  const view = loadKnowledge(db);
  const planned = new Set(state.plan.steps.map((s) => s.nodeId));
  const hops = new Map<string, number>();
  let layer = [step.nodeId];
  for (let h = 1; layer.length && h <= 6; h += 1) {
    const next: string[] = [];
    for (const id of layer) {
      for (const chain of view.index.into.get(id) ?? []) {
        for (const p of chain.premises) {
          if (hops.has(p) || p === step.nodeId) continue;
          hops.set(p, h);
          next.push(p);
        }
      }
    }
    layer = next;
  }
  const candidates = [...hops].flatMap(([id, h]) => {
    const node = view.nodes.get(id);
    return node && view.fringe.has(id) && !view.owned.has(id) && !planned.has(id) ? [{ id, name: node.name, aliases: node.aliases, hops: h }] : [];
  });
  const id = premiseToPullIn(gap, candidates);
  const node = id ? view.nodes.get(id) : undefined;
  if (!id || !node) return null;
  const fromDepth = (view.states.get(id)?.depth ?? 0) as Depth;
  const aim = SIMPLE_AIM as Depth;
  return { nodeId: id, name: node.name, kind: node.kind, why: `${step.name.replace(/\$/g, '')} builds on it, and your answer showed it was missing.`, aim, fromDepth, minutes: stepMinutes(node.kind, fromDepth, aim, learnerSpeedNow(db)), simplified: null, dependsOn: [] };
}

/** What the learner reads on a prerequisite pulled in: why it came first, and where the session goes back to. */
export function pulledInNote(state: SessionState, nodeId: string): string | null {
  const pull = state.pulledIn?.find((p) => p.nodeId === nodeId && !p.returned);
  const forName = pull ? state.plan.steps.find((s) => s.nodeId === pull.for)?.name : undefined;
  return forName ? `Your last answer showed this was missing for ${forName}, so it comes first. Then back to ${forName}.` : null;
}

/** Teach `premise` now, before the idea it is for; that idea comes back at the question it missed. */
export function pullIn(db: Database, sessionId: string, state: SessionState, step: LessonStep, premise: LessonStep, stage: Stage): void {
  state.plan.steps.splice(state.stepIndex, 0, premise);
  state.nodeStatus[premise.nodeId] = 'pending';
  state.nodeStatus[step.nodeId] = 'pending';
  state.pulledIn = [...(state.pulledIn ?? []), { nodeId: premise.nodeId, for: step.nodeId, stage }];
  appendSessionEvent(db, sessionId, 'pull-in', { nodeId: premise.nodeId, for: step.nodeId, stage });
}
