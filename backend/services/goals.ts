/**
 * Goals (design §3): compile a goal into capabilities and targets, creating unverified nodes for
 * ideas the graph lacks, then refresh target depths and tiers.
 */
import { runGoalCompiler } from '../agents/goalCompiler';
import type { GraphSummaryEntry } from '../agents/goalCompiler';
import type { Capability, Depth, Goal, KnowledgeNode, Target } from '../core/types';
import type { Embedder } from '../ingest/embedder';
import { cosine } from '../ingest/similarity';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { listEmbeddings } from '../store/embeddings';
import { getState } from '../store/evidence';
import { getGoal, listCapabilities, listGoals, listTargets, saveCompile } from '../store/goals';
import { newId } from '../store/ids';
import { createUnverifiedNodes, getNodes, listNodes } from '../store/world';
import { refreshGoalFields } from './knowledge';

const MAX_GRAPH_NODES = 400;

export interface GoalDetail {
  goal: Goal;
  capabilities: (Capability & { targets: (Target & { name: string; kind: KnowledgeNode['kind']; status: KnowledgeNode['status']; currentDepth: Depth })[] })[];
}

export function goalDetail(db: Database, goalId: string): GoalDetail | undefined {
  const goal = getGoal(db, goalId);
  if (!goal) return undefined;
  const targets = listTargets(db, goalId);
  const nodes = getNodes(
    db,
    targets.map((t) => t.nodeId),
  );
  const capabilities = listCapabilities(db, goalId).map((cap) => ({
    ...cap,
    targets: targets
      .filter((t) => t.capabilityId === cap.id)
      .map((t) => {
        const node = nodes.get(t.nodeId);
        return { ...t, name: node?.name ?? t.nodeId, kind: node?.kind ?? 'claim', status: node?.status ?? 'verified', currentDepth: getState(db, t.nodeId)?.depth ?? 0 };
      }),
  }));
  return { goal, capabilities };
}

export function listGoalDetails(db: Database): GoalDetail[] {
  return listGoals(db)
    .map((g) => goalDetail(db, g.id))
    .filter((g): g is GoalDetail => g !== undefined);
}

export interface CompileOptions {
  db: Database;
  provider: LlmProvider;
  /** Used to pick the most relevant nodes when the graph is larger than the summary budget. */
  embedder?: Embedder;
}

export async function compileGoal(options: CompileOptions, goalId: string): Promise<GoalDetail> {
  const { db, provider } = options;
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`unknown goal ${goalId}`);
  const { graph, truncated } = await graphSummary(options, goal.text);
  const result = await runGoalCompiler(provider, { goalText: goal.text, priority: goal.priority, graph, truncated });

  transaction(db, () => {
    const tempToId = new Map<string, string>();
    const created = result.newNodes.map((n) => {
      const id = newId('node');
      tempToId.set(n.tempId, id);
      return { id, kind: n.kind, name: n.name, statement: n.statement, aliases: [] };
    });
    if (created.length) createUnverifiedNodes(db, created);
    saveCompile(
      db,
      goalId,
      result.capabilities.map((c) => ({
        statement: c.statement,
        targets: dedupeTargets(c.targets.map((t) => ({ nodeId: tempToId.get(t.ref) ?? t.ref, depth: t.depth as Depth }))),
      })),
    );
  });
  refreshGoalFields(db);
  return goalDetail(db, goalId) as GoalDetail;
}

function dedupeTargets(targets: { nodeId: string; depth: Depth }[]): { nodeId: string; depth: Depth }[] {
  const best = new Map<string, Depth>();
  for (const t of targets) if ((best.get(t.nodeId) ?? 0) < t.depth) best.set(t.nodeId, t.depth);
  return [...best.entries()].map(([nodeId, depth]) => ({ nodeId, depth }));
}

async function graphSummary(options: CompileOptions, goalText: string): Promise<{ graph: GraphSummaryEntry[]; truncated: boolean }> {
  const nodes = listNodes(options.db);
  const entries = nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name, statement: n.statement }));
  if (entries.length <= MAX_GRAPH_NODES || !options.embedder) return { graph: entries.slice(0, MAX_GRAPH_NODES), truncated: entries.length > MAX_GRAPH_NODES };
  const [query] = await options.embedder.embed([goalText]);
  const vectors = new Map(listEmbeddings(options.db, options.embedder.model).map((e) => [e.nodeId, e.vector]));
  const scored = entries.map((e) => {
    const v = vectors.get(e.id);
    return { entry: e, score: v && query ? cosine(query, v) : 0 };
  });
  scored.sort((a, b) => b.score - a.score);
  return { graph: scored.slice(0, MAX_GRAPH_NODES).map((s) => s.entry), truncated: true };
}
