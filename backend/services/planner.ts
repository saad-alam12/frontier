/**
 * Lesson planning: code computes the candidates reachable from the fringe; the planner agent picks
 * and orders a coherent subset; code re-checks the order.
 */
import { runPlanner } from '../agents/planner';
import type { PlannerCandidate } from '../agents/planner';
import { dependents } from '../core/graph';
import { targetDepthFor } from '../core/leverage';
import { computeFringe, doneSet } from '../core/ownership';
import { orderByDependencies, planCandidates, withPrerequisites } from '../core/plan';
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
  /** Null for a free session with no goal. */
  goalId: string | null;
  title: string;
  orientation: string;
  steps: LessonStep[];
  /** Everything learnable now or soon, for the side panel. */
  candidateCount: number;
  /** Targets with no path from the fringe (missing chains, ungrounded nodes). */
  unreachableTargets: { nodeId: string; name: string }[];
}

/**
 * What a session on the goal can teach: candidates reachable from the fringe toward the targets. With
 * `focus` (going deeper), only those ideas are targets, and they count as not done even when owned.
 */
export function candidatesForGoal(db: Database, goalId: string, view: KnowledgeView = loadKnowledge(db), focus?: string[]) {
  const aims = new Map<string, number>();
  for (const t of listTargets(db, goalId)) if (view.nodes.has(t.nodeId)) aims.set(t.nodeId, Math.max(aims.get(t.nodeId) ?? 0, t.depth));
  const targetIds = focus ? focus.filter((id) => view.nodes.has(id)) : [...aims.keys()];
  const done = doneSet(view.owned, view.states, aims);
  for (const id of focus ?? []) done.delete(id);
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
 * A session the learner chose, going deeper on simplified ideas: those ideas at the depth the goal
 * asks, after any premises they still need, in dependency order and cut to 45 minutes. No planner call.
 */
export function planFocusSession(db: Database, goalId: string, focus: string[]): LessonPlan {
  const view = loadKnowledge(db);
  const speed = learnerSpeedNow(db);
  const { candidates, unreachable } = candidatesForGoal(db, goalId, view, focus);
  const wanted = new Set(focus);
  const ideal = new Map<string, number>();
  for (const t of listTargets(db, goalId, { all: true })) if (wanted.has(t.nodeId)) ideal.set(t.nodeId, Math.max(ideal.get(t.nodeId) ?? 0, t.idealDepth));
  const nameOf = (id: string) => view.nodes.get(id)?.name ?? id;
  const steps: LessonStep[] = candidates.map((c) => {
    const node = view.nodes.get(c.nodeId);
    const fromDepth = view.states.get(c.nodeId)?.depth ?? 0;
    const aim = (wanted.has(c.nodeId) ? Math.max(ideal.get(c.nodeId) ?? 0, aimFor(c.nodeId, view)) : aimFor(c.nodeId, view)) as Depth;
    return {
      nodeId: c.nodeId,
      name: nameOf(c.nodeId),
      kind: node?.kind ?? 'claim',
      why: wanted.has(c.nodeId) ? 'You chose to go deeper on this, as far as the goal asks.' : 'An idea it needs that is not yours yet.',
      aim,
      fromDepth,
      minutes: stepMinutes(node?.kind ?? 'claim', fromDepth, aim, speed),
      simplified: null,
      dependsOn: c.dependsOn,
    };
  });
  const names = focus.map(nameOf);
  return {
    goalId,
    title: 'Going deeper',
    orientation: `Today goes deeper on ${names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ')}, as far as the goal asks.`,
    ...fitSession(steps, 0),
    candidateCount: candidates.length,
    unreachableTargets: unreachable,
  };
}

/** Keep steps in order while they fit the session (always at least one), and drop links to steps that did not fit. */
function fitSession(steps: LessonStep[], reservedMinutes: number, sessionMinutes = SESSION_MINUTES): { steps: LessonStep[] } {
  const fitted: LessonStep[] = [];
  let minutes = reservedMinutes;
  for (const step of steps) {
    if (fitted.length > 0 && minutes + step.minutes > sessionMinutes) break;
    fitted.push(step);
    minutes += step.minutes;
  }
  const kept = new Set(fitted.map((st) => st.nodeId));
  return { steps: fitted.map((st) => ({ ...st, dependsOn: st.dependsOn.filter((d) => kept.has(d)) })) };
}

/**
 * Plan a session: the planner picks and orders up to `maxNodes` ideas; code keeps them in order while
 * they fit the session's 45 minutes (always at least one), counting `reservedMinutes` already taken
 * (an idea carried over from last time).
 */
export async function planSession(db: Database, provider: LlmProvider, goalId: string, options: { maxNodes?: number; reservedMinutes?: number; sessionMinutes?: number } = {}): Promise<LessonPlan> {
  const length = options.sessionMinutes ?? SESSION_MINUTES;
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
    sessionMinutes: length - (options.reservedMinutes ?? 0),
  });
  const byId = new Map(candidates.map((c) => [c.nodeId, c]));
  const simplified = new Map<string, string>();
  for (const t of listTargets(db, goalId, { all: true })) if (t.simplified && !simplified.has(t.nodeId)) simplified.set(t.nodeId, t.simplified);
  const whyById = new Map(result.steps.map((s) => [s.nodeId, s.why]));
  // the planner picks; code makes sure nothing is taught before what it is built on
  const picked = withPrerequisites(
    result.steps.map((s) => s.nodeId),
    byId,
  );
  for (const [id, forId] of picked.neededFor) whyById.set(id, `${view.nodes.get(forId)?.name ?? 'A later idea'} is built on it.`);
  const ordered = orderByDependencies(picked.ids, byId);
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
  return {
    goalId,
    title: result.title,
    orientation: result.orientation,
    ...fitSession(steps, options.reservedMinutes ?? 0, length),
    candidateCount: candidates.length,
    unreachableTargets: unreachable,
  };
}
