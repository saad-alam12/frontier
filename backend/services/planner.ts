/**
 * Lesson planning: code computes the candidates reachable from the fringe; the planner agent picks
 * and orders a coherent subset; code re-checks the order.
 */
import { runPlanner } from '../agents/planner';
import type { PlannerCandidate } from '../agents/planner';
import { dependents } from '../core/graph';
import { targetDepthFor } from '../core/leverage';
import { computeFringe, doneSet } from '../core/ownership';
import { orderByDependencies, planCandidates } from '../core/plan';
import { SESSION_MINUTES, ideaMinutes } from '../core/budget';
import { IDEA_MAX_MINUTES } from '../core/session';
import { OWNED_DEPTH } from '../core/types';
import type { Depth, NodeKind } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { getGoal, listCapabilities, listMaterials, listTargets } from '../store/goals';
import { learnerSpeedNow } from './budget';
import { loadKnowledge } from './knowledge';
import type { KnowledgeView } from './knowledge';

export const MAX_PLAN_NODES = 6;

export interface LessonStep {
  nodeId: string;
  name: string;
  kind: string;
  why: string;
  /** The depth this session takes the idea to: the deepest planned depth an active goal holds (2 for a premise no goal targets). */
  aim: Depth;
  /** Its depth when planned; 2 or more means deepening an idea the learner already explains. */
  fromDepth: Depth;
  /** Minutes the plan prices it at for this learner (at most 30); the session's time box allows at least 10. */
  minutes: number;
  /** Why the idea was simplified for this goal, once it was. */
  simplified: string | null;
  dependsOn: string[];
}

/** The aim of an idea in a session: what the plan asks of it; a premise no goal targets is learned to be owned. */
function aimFor(nodeId: string, view: KnowledgeView): Depth {
  return targetDepthFor(nodeId, view.goals) || OWNED_DEPTH;
}

/** Minutes an idea takes this session, from the cost model and the learner's speed; never more than its half hour. */
export function stepMinutes(kind: NodeKind, fromDepth: number, aim: number, speed: number): number {
  return Math.max(1, Math.round(Math.min(IDEA_MAX_MINUTES, ideaMinutes(kind, fromDepth, aim, speed))));
}

export interface LessonPlan {
  goalId: string;
  title: string;
  orientation: string;
  steps: LessonStep[];
  /** Everything learnable now or soon, for the side panel. */
  candidateCount: number;
  /** Targets with no path from the fringe (missing chains, ungrounded nodes). */
  unreachableTargets: { nodeId: string; name: string }[];
}

export function candidatesForGoal(db: Database, goalId: string, view: KnowledgeView = loadKnowledge(db)) {
  const aims = new Map<string, number>();
  for (const t of listTargets(db, goalId)) if (view.nodes.has(t.nodeId)) aims.set(t.nodeId, Math.max(aims.get(t.nodeId) ?? 0, t.depth));
  const targetIds = [...aims.keys()];
  const done = doneSet(view.owned, view.states, aims);
  // Unverified ideas (a compile's guesses no source covers yet) are taught for goals with no material
  // at all, for personal goals whose material covers only part of the goal (the compile built the
  // rest), or when the learner chose to start one. A course's expected ideas wait for its lectures.
  const goal = getGoal(db, goalId);
  const fromScratch = listMaterials(db, goalId).length === 0;
  const selfBuilt = goal?.kind === 'personal' && (goal.coverage === 'partial' || goal.coverage === 'fragment');
  const teachable = (id: string) => view.nodes.get(id)?.status !== 'unverified' || fromScratch || selfBuilt || (goal?.startedUnverified.includes(id) ?? false);
  const fringe = new Set([...computeFringe({ nodes: view.nodes.values(), index: view.index, owned: done })].filter(teachable));
  const candidates = planCandidates(targetIds, done, fringe, view.index);
  const candidateSet = new Set(candidates.map((c) => c.nodeId));
  const unreachable = targetIds.filter((id) => !done.has(id) && !candidateSet.has(id)).map((id) => ({ nodeId: id, name: view.nodes.get(id)?.name ?? id }));
  return { targetIds, candidates, unreachable };
}

/**
 * Plan a session: the planner picks and orders up to `maxNodes` ideas; code keeps them in order while
 * they fit the session's 45 minutes (always at least one), counting `reservedMinutes` already taken
 * (an idea carried over from last time).
 */
export async function planSession(db: Database, provider: LlmProvider, goalId: string, options: { maxNodes?: number; reservedMinutes?: number } = {}): Promise<LessonPlan> {
  const maxNodes = options.maxNodes ?? MAX_PLAN_NODES;
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`unknown goal ${goalId}`);
  const view = loadKnowledge(db);
  const speed = learnerSpeedNow(db);
  const { targetIds, candidates, unreachable } = candidatesForGoal(db, goalId, view);
  if (candidates.length === 0) {
    return { goalId, title: 'Nothing to plan yet', orientation: targetIds.length ? 'Every target is owned or unreachable from what you know.' : 'Compile the goal first.', steps: [], candidateCount: 0, unreachableTargets: unreachable };
  }
  const targetSet = new Set(targetIds);
  const plannerCandidates: PlannerCandidate[] = candidates.map((c) => {
    const node = view.nodes.get(c.nodeId);
    const state = view.states.get(c.nodeId);
    let unlocks = targetSet.has(c.nodeId) ? 1 : 0;
    for (const dep of dependents(c.nodeId, view.index, 1).keys()) if (targetSet.has(dep)) unlocks += 1;
    return {
      nodeId: c.nodeId,
      kind: node?.kind ?? 'claim',
      name: node?.name ?? c.nodeId,
      statement: node?.statement ?? '',
      onFringe: c.onFringe,
      layer: c.layer,
      dependsOn: c.dependsOn,
      unlocksTargets: unlocks,
      targetDepth: aimFor(c.nodeId, view),
      currentDepth: state?.depth ?? 0,
      minutes: stepMinutes(node?.kind ?? 'claim', state?.depth ?? 0, aimFor(c.nodeId, view), speed),
    };
  });
  const result = await runPlanner(provider, {
    goalText: goal.text,
    examStyle: goal.examProfile?.summary ?? null,
    capabilities: listCapabilities(db, goalId).map((c) => c.statement),
    targets: targetIds.map((id) => ({ nodeId: id, name: view.nodes.get(id)?.name ?? id, targetDepth: targetDepthFor(id, view.goals), currentDepth: view.states.get(id)?.depth ?? 0 })),
    candidates: plannerCandidates,
    ownedNames: [...view.owned].map((id) => view.nodes.get(id)?.name ?? id).slice(0, 60),
    maxNodes,
    sessionMinutes: SESSION_MINUTES - (options.reservedMinutes ?? 0),
  });
  const byId = new Map(candidates.map((c) => [c.nodeId, c]));
  const simplified = new Map<string, string>();
  for (const t of listTargets(db, goalId, { all: true })) if (t.simplified && !simplified.has(t.nodeId)) simplified.set(t.nodeId, t.simplified);
  const whyById = new Map(result.steps.map((s) => [s.nodeId, s.why]));
  const ordered = orderByDependencies(
    result.steps.map((s) => s.nodeId),
    byId,
  );
  const steps: LessonStep[] = ordered.map((id) => {
    const node = view.nodes.get(id);
    const fromDepth = view.states.get(id)?.depth ?? 0;
    const aim = aimFor(id, view);
    return {
      nodeId: id,
      name: node?.name ?? id,
      kind: node?.kind ?? 'claim',
      why: whyById.get(id) ?? '',
      aim,
      fromDepth,
      minutes: stepMinutes(node?.kind ?? 'claim', fromDepth, aim, speed),
      simplified: simplified.get(id) ?? null,
      dependsOn: (byId.get(id)?.dependsOn ?? []).filter((d) => ordered.includes(d)),
    };
  });
  const fitted: LessonStep[] = [];
  let minutes = options.reservedMinutes ?? 0;
  for (const step of steps) {
    if (fitted.length > 0 && minutes + step.minutes > SESSION_MINUTES) break;
    fitted.push(step);
    minutes += step.minutes;
  }
  const kept = new Set(fitted.map((st) => st.nodeId));
  return {
    goalId,
    title: result.title,
    orientation: result.orientation,
    steps: fitted.map((st) => ({ ...st, dependsOn: st.dependsOn.filter((d) => kept.has(d)) })),
    candidateCount: candidates.length,
    unreachableTargets: unreachable,
  };
}
