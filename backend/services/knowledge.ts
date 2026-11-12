/**
 * Read-side view of the two layers together: the graph, the learner's states, who owns what and
 * what is on the fringe. Used by delta classification, planning and scheduling.
 */
import type { GraphIndex } from '../core/graph';
import { assignTiers, leverageOf, targetDepthFor } from '../core/leverage';
import type { GoalContext, LeverageScore } from '../core/leverage';
import { computeFringe, ownedSet } from '../core/ownership';
import type { Chain, KnowledgeNode, NodeState, Tier } from '../core/types';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { listStates, nodesWithEvidence } from '../store/evidence';
import { listCapabilities, listGoals, listTargets } from '../store/goals';
import { freezeTimeOwners, replan } from './budget';
import { getSetting, setSetting } from '../store/settingsTable';
import { cachedRead } from '../store/readCache';
import { worldGraph } from './worldGraph';
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
  /** An idea's centrality on the map (design §5), worked out once per idea until the graph changes. */
  centrality: (nodeId: string) => number;
}

export function loadKnowledge(db: Database, now = new Date()): KnowledgeView {
  // a screen asks for the view several times (a goal page once per part): what is stored is read once
  // until the next write; what is owned is worked out each time, since it moves with the clock
  const { nodes, chains, index, centrality } = worldGraph(db);
  const { states, goals } = cachedRead(db, 'knowledge', () => ({
    states: listStates(db),
    goals: {
      goals: new Map(listGoals(db).map((g) => [g.id, g])),
      capabilities: new Map(listCapabilities(db).map((c) => [c.id, c])),
      targets: listTargets(db),
    } satisfies GoalContext,
  }));
  const owned = ownedSet(states.values(), now);
  const fringe = computeFringe({ nodes: nodes.values(), index, owned });
  return { nodes, chains, index, states, owned, fringe, goals, now, centrality };
}

export function leverageScores(view: KnowledgeView): LeverageScore[] {
  const scores: LeverageScore[] = [];
  for (const node of view.nodes.values()) scores.push(leverageOf(node, view.states.get(node.id), view.index, view.owned, view.goals, view.centrality));
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
      const targetDepth = targetDepthFor(node.id, view.goals);
      const tier = tiers.get(node.id) ?? 'archive';
      // most ideas keep their fields after an answer: only the ones that change are written
      const known = view.states.get(node.id);
      if (known && known.targetDepth === targetDepth && known.tier === tier) continue;
      setGoalFields(db, node.id, targetDepth, tier);
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

/**
 * Study time logged before each span stored who it belongs to is given its owners once, by the goals
 * as they are now. From then on the minutes stay with those goals.
 */
export function upgradeTimeOwners(db: Database): void {
  if (getSetting(db, TIME_OWNERS_KEY) === '1') return;
  transaction(db, () => {
    freezeTimeOwners(db);
    setSetting(db, TIME_OWNERS_KEY, '1');
  });
}
const TIME_OWNERS_KEY = 'time.owners';

export function upgradeDerivedStates(db: Database): void {
  if (Number(getSetting(db, STATE_RULES_KEY) ?? 1) >= STATE_RULES) return;
  transaction(db, () => {
    for (const nodeId of nodesWithEvidence(db)) recomputeState(db, nodeId);
    setSetting(db, STATE_RULES_KEY, String(STATE_RULES));
  });
  refreshGoalFields(db);
}
