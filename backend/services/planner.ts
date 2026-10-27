/**
 * Lesson planning: code computes the candidates reachable from the fringe; the planner agent picks
 * and orders a coherent subset; code re-checks the order.
 */
import { runPlanner } from '../agents/planner';
import type { PlannerCandidate } from '../agents/planner';
import { dependents } from '../core/graph';
import { targetDepthFor } from '../core/leverage';
import { orderByDependencies, planCandidates } from '../core/plan';
import type { Depth, Tier } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { getGoal, listCapabilities, listTargets } from '../store/goals';
import { loadKnowledge } from './knowledge';
import type { KnowledgeView } from './knowledge';

export const MAX_PLAN_NODES = 6;

export type StepMode = 'teach' | 'index' | 'derive';

export interface LessonStep {
  nodeId: string;
  name: string;
  kind: string;
  why: string;
  mode: StepMode;
  tier: Tier;
  targetDepth: Depth;
  dependsOn: string[];
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
  const targetIds = [...new Set(listTargets(db, goalId).map((t) => t.nodeId))].filter((id) => view.nodes.has(id));
  // Unverified ideas (a compile's guesses that no source covers yet) are not taught.
  const fringe = new Set([...view.fringe].filter((id) => view.nodes.get(id)?.status !== 'unverified'));
  const candidates = planCandidates(targetIds, view.owned, fringe, view.index);
  const candidateSet = new Set(candidates.map((c) => c.nodeId));
  const unreachable = targetIds.filter((id) => !view.owned.has(id) && !candidateSet.has(id)).map((id) => ({ nodeId: id, name: view.nodes.get(id)?.name ?? id }));
  return { targetIds, candidates, unreachable };
}

export function modeFor(tier: Tier, targetDepth: Depth): StepMode {
  if (tier === 'index') return 'index';
  return targetDepth >= 3 ? 'derive' : 'teach';
}

export async function planSession(db: Database, provider: LlmProvider, goalId: string, maxNodes = MAX_PLAN_NODES): Promise<LessonPlan> {
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`unknown goal ${goalId}`);
  const view = loadKnowledge(db);
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
      tier: state?.tier ?? 'archive',
      onFringe: c.onFringe,
      layer: c.layer,
      dependsOn: c.dependsOn,
      unlocksTargets: unlocks,
      targetDepth: targetDepthFor(c.nodeId, view.goals),
      currentDepth: state?.depth ?? 0,
    };
  });
  const result = await runPlanner(provider, {
    goalText: goal.text,
    capabilities: listCapabilities(db, goalId).map((c) => c.statement),
    targets: targetIds.map((id) => ({ nodeId: id, name: view.nodes.get(id)?.name ?? id, targetDepth: targetDepthFor(id, view.goals), currentDepth: view.states.get(id)?.depth ?? 0 })),
    candidates: plannerCandidates,
    ownedNames: [...view.owned].map((id) => view.nodes.get(id)?.name ?? id).slice(0, 60),
    maxNodes,
  });
  const byId = new Map(candidates.map((c) => [c.nodeId, c]));
  const whyById = new Map(result.steps.map((s) => [s.nodeId, s.why]));
  const ordered = orderByDependencies(
    result.steps.map((s) => s.nodeId),
    byId,
  );
  const steps: LessonStep[] = ordered.map((id) => {
    const node = view.nodes.get(id);
    const state = view.states.get(id);
    const tier = state?.tier ?? 'archive';
    const targetDepth = targetDepthFor(id, view.goals);
    return {
      nodeId: id,
      name: node?.name ?? id,
      kind: node?.kind ?? 'claim',
      why: whyById.get(id) ?? '',
      mode: modeFor(tier, targetDepth),
      tier,
      targetDepth,
      dependsOn: (byId.get(id)?.dependsOn ?? []).filter((d) => ordered.includes(d)),
    };
  });
  return { goalId, title: result.title, orientation: result.orientation, steps, candidateCount: candidates.length, unreachableTargets: unreachable };
}
