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
  goals: Map<string, Pick<Goal, 'id' | 'priority' | 'status'>>;
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
  centralityOf: (nodeId: string) => number = (id) => centrality(id, index),
): LeverageScore {
  const relevance = goalRelevance(node.id, ctx);
  const central = 1 + centralityOf(node.id);
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

/**
 * Tiers (design §6) follow the plan: an idea planned to be explained or deeper (depth 2+) gets the
 * full step loop and is maintained by practice; one planned only to be recognized gets an index pass;
 * one no active goal plans is archived.
 */
export function assignTiers(scores: LeverageScore[]): Map<string, Tier> {
  const tiers = new Map<string, Tier>();
  for (const s of scores) tiers.set(s.nodeId, s.targetDepth >= 2 ? 'internalize' : s.targetDepth === 1 ? 'index' : 'archive');
  return tiers;
}
