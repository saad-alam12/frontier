/**
 * Read-side view of the two layers together: the graph, the learner's states, who owns what and
 * what is on the fringe. Used by delta classification, planning and scheduling.
 */
import { indexChains } from '../core/graph';
import type { GraphIndex } from '../core/graph';
import { assignTiers, leverageOf, targetDepthFor } from '../core/leverage';
import type { GoalContext, LeverageScore } from '../core/leverage';
import { computeFringe, ownedSet } from '../core/ownership';
import type { Chain, KnowledgeNode, NodeState, Tier } from '../core/types';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { listStates, nodesWithEvidence } from '../store/evidence';
import { listCapabilities, listGoals, listTargets } from '../store/goals';
import { listChains, listNodes } from '../store/world';
import { replan } from './budget';
import { getSetting, setSetting } from '../store/settingsTable';
import { recomputeState, setGoalFields } from './evidence';

export interface KnowledgeView {
  nodes: Map<string, KnowledgeNode>;
  chains: Chain[];
  index: GraphIndex;
  states: Map<string, NodeState>;
  owned: Set<string>;
  fringe: Set<string>;
  goals: GoalContext;
  now: Date;
}

export function loadKnowledge(db: Database, now = new Date()): KnowledgeView {
  const nodes = new Map(listNodes(db).map((n) => [n.id, n]));
  const chains = listChains(db);
  const index = indexChains(chains);
  const states = listStates(db);
  const goals: GoalContext = {
    goals: new Map(listGoals(db).map((g) => [g.id, g])),
    capabilities: new Map(listCapabilities(db).map((c) => [c.id, c])),
    targets: listTargets(db),
  };
  const owned = ownedSet(states.values(), now);
  const fringe = computeFringe({ nodes: nodes.values(), index, owned });
  return { nodes, chains, index, states, owned, fringe, goals, now };
}

export function leverageScores(view: KnowledgeView): LeverageScore[] {
  const scores: LeverageScore[] = [];
  for (const node of view.nodes.values()) scores.push(leverageOf(node, view.states.get(node.id), view.index, view.owned, view.goals));
  return scores.sort((a, b) => b.leverage - a.leverage || a.nodeId.localeCompare(b.nodeId));
}

/**
 * Re-plan the time budgets, then recompute targetDepth and tier for every node from the active goals'
 * planned depths. Call after compiles, merges, goal edits and sessions.
 */
export function refreshGoalFields(db: Database): Map<string, Tier> {
  replan(db);
  const view = loadKnowledge(db);
  const tiers = assignTiers(leverageScores(view));
  transaction(db, () => {
    for (const node of view.nodes.values()) {
      setGoalFields(db, node.id, targetDepthFor(node.id, view.goals), tiers.get(node.id) ?? 'archive');
    }
  });
  return tiers;
}

/**
 * The rules that turn evidence into depth and freshness, as a number. Stored states are derived, so
 * when the rules change they are derived again from the evidence, once, the next time the database
 * opens. 2: one review per sitting with the prediction left out, real elapsed time, failed answers
 * never lengthen the interval, no review from lookups or failed tasks, depth drops after two clear
 * failures on different days.
 */
export const STATE_RULES = 2;
const STATE_RULES_KEY = 'states.rules';

export function upgradeDerivedStates(db: Database): void {
  if (Number(getSetting(db, STATE_RULES_KEY) ?? 1) >= STATE_RULES) return;
  transaction(db, () => {
    for (const nodeId of nodesWithEvidence(db)) recomputeState(db, nodeId);
    setSetting(db, STATE_RULES_KEY, String(STATE_RULES));
  });
  refreshGoalFields(db);
}
