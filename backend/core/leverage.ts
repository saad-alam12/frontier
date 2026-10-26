/**
 * Effort economics (design §6): leverage = goalRelevance × centrality × depthGap / expectedEffort,
 * and tier assignment from targets and leverage.
 */
import { dependents } from './graph';
import type { GraphIndex } from './graph';
import type { Capability, Depth, Goal, KnowledgeNode, NodeState, Target, Tier } from './types';

export const CENTRALITY_DECAY = 0.5;

/** Number of nodes that depend on `nodeId` through chains, transitively, with decay per hop. */
export function centrality(nodeId: string, index: GraphIndex, decay = CENTRALITY_DECAY): number {
  let total = 0;
  for (const weight of dependents(nodeId, index, decay).values()) total += weight;
  return total;
}

export interface GoalContext {
  goals: Map<string, Goal>;
  capabilities: Map<string, Capability>;
  targets: Target[];
}

/** Sum over active capabilities needing the node, weighted by goal priority. */
export function goalRelevance(nodeId: string, ctx: GoalContext): number {
  let total = 0;
  for (const t of ctx.targets) {
    if (t.nodeId !== nodeId) continue;
    const cap = ctx.capabilities.get(t.capabilityId);
    if (!cap || cap.masteredAt) continue;
    const goal = ctx.goals.get(cap.goalId);
    if (!goal || goal.status !== 'active') continue;
    total += goal.priority;
  }
  return total;
}

/** The deepest depth any active goal asks of the node. */
export function targetDepthFor(nodeId: string, ctx: GoalContext): Depth {
  let depth: Depth = 0;
  for (const t of ctx.targets) {
    if (t.nodeId !== nodeId) continue;
    const cap = ctx.capabilities.get(t.capabilityId);
    const goal = cap ? ctx.goals.get(cap.goalId) : undefined;
    if (!goal || goal.status !== 'active') continue;
    if (t.depth > depth) depth = t.depth;
  }
  return depth;
}

export function depthGap(state: NodeState | undefined, targetDepth: Depth): number {
  return Math.max(0, targetDepth - (state?.depth ?? 0));
}

/**
 * Expected effort in rough "step units": one for the node itself, plus one for each premise that is not
 * owned along the cheapest chain into it. Terms are cheaper than claims and procedures.
 */
export function expectedEffort(node: KnowledgeNode, index: GraphIndex, owned: Set<string>): number {
  const chains = index.into.get(node.id) ?? [];
  let cheapest = 0;
  if (chains.length) {
    cheapest = Math.min(...chains.map((c) => c.premises.filter((p) => !owned.has(p)).length));
  }
  const base = node.kind === 'term' ? 0.5 : 1;
  return base + cheapest;
}

export interface LeverageScore {
  nodeId: string;
  leverage: number;
  goalRelevance: number;
  centrality: number;
  depthGap: number;
  expectedEffort: number;
  targetDepth: Depth;
}

export function leverageOf(
  node: KnowledgeNode,
  state: NodeState | undefined,
  index: GraphIndex,
  owned: Set<string>,
  ctx: GoalContext,
): LeverageScore {
  const relevance = goalRelevance(node.id, ctx);
  const central = 1 + centrality(node.id, index);
  const target = targetDepthFor(node.id, ctx);
  const gap = depthGap(state, target);
  const effort = expectedEffort(node, index, owned);
  return {
    nodeId: node.id,
    leverage: (relevance * central * gap) / effort,
    goalRelevance: relevance,
    centrality: central,
    depthGap: gap,
    expectedEffort: effort,
    targetDepth: target,
  };
}

/** Share of goal-targeted nodes (by leverage) that are promoted to the internalize tier even if their target depth is low. */
export const INTERNALIZE_SHARE = 0.2;

/**
 * Tiers (design §6): nodes a goal needs at depth 3+ are internalized; other targeted nodes are indexed,
 * except the top share by leverage among claims and procedures, which are internalized too; nodes no goal
 * needs are archived.
 */
export function assignTiers(scores: LeverageScore[], kinds: Map<string, KnowledgeNode['kind']>): Map<string, Tier> {
  const tiers = new Map<string, Tier>();
  const targeted = scores.filter((s) => s.targetDepth > 0);
  const promotable = targeted
    .filter((s) => s.targetDepth < 3 && kinds.get(s.nodeId) !== 'term')
    .sort((a, b) => b.leverage - a.leverage || a.nodeId.localeCompare(b.nodeId));
  const promoteCount = Math.floor(targeted.length * INTERNALIZE_SHARE);
  const promoted = new Set(promotable.slice(0, promoteCount).map((s) => s.nodeId));
  for (const s of scores) {
    if (s.targetDepth === 0) tiers.set(s.nodeId, 'archive');
    else if (s.targetDepth >= 3 || promoted.has(s.nodeId)) tiers.set(s.nodeId, 'internalize');
    else tiers.set(s.nodeId, 'index');
  }
  return tiers;
}
