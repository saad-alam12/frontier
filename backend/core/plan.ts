/**
 * Lesson planning mechanics (design §4.1 step 3): the candidate set is everything reachable from the
 * fringe toward the targets, in dependency layers. The planner agent only chooses among these.
 */
import { ancestors } from './graph';
import type { GraphIndex } from './graph';

export interface PlanCandidate {
  nodeId: string;
  /** 0 for nodes on the fringe now, 1 for nodes unlocked by layer 0, and so on. */
  layer: number;
  /** Premises (of the chain that unlocks it) that are candidates rather than owned. */
  dependsOn: string[];
  onFringe: boolean;
}

/**
 * Walk from the fringe toward the targets: a node joins the candidate set once some chain into it
 * has all premises owned or already candidates. Only nodes relevant to the targets (the targets and
 * their ancestry) are considered. Returns candidates ordered by layer, then id.
 */
export function planCandidates(targetIds: Iterable<string>, owned: Set<string>, fringe: Set<string>, index: GraphIndex): PlanCandidate[] {
  const relevant = new Set<string>();
  for (const t of targetIds) {
    if (owned.has(t)) continue;
    relevant.add(t);
    for (const a of ancestors(t, index)) if (!owned.has(a)) relevant.add(a);
  }
  const candidates = new Map<string, PlanCandidate>();
  let layer = 0;
  let added = [...fringe].filter((id) => relevant.has(id)).sort();
  for (const id of added) candidates.set(id, { nodeId: id, layer, dependsOn: [], onFringe: true });
  while (added.length) {
    layer += 1;
    const next: string[] = [];
    for (const id of relevant) {
      if (candidates.has(id)) continue;
      const chains = index.into.get(id) ?? [];
      const unlocking = chains.find((c) => c.premises.every((p) => owned.has(p) || candidates.has(p)));
      if (!unlocking) continue;
      next.push(id);
      candidates.set(id, { nodeId: id, layer, dependsOn: unlocking.premises.filter((p) => candidates.has(p)), onFringe: false });
    }
    next.sort();
    added = next;
  }
  return [...candidates.values()].sort((a, b) => a.layer - b.layer || a.nodeId.localeCompare(b.nodeId));
}

/**
 * The chosen ideas together with everything they need that the learner does not own yet: an idea is
 * never planned without the candidates it is built on. Returns the chosen ideas first, then what was
 * added for them (each with the chosen idea that needs it).
 */
export function withPrerequisites(chosen: string[], candidates: Map<string, PlanCandidate>): { ids: string[]; neededFor: Map<string, string> } {
  const ids = [...new Set(chosen)];
  const have = new Set(ids);
  const neededFor = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i] as string;
    for (const dep of candidates.get(id)?.dependsOn ?? []) {
      if (have.has(dep) || !candidates.has(dep)) continue;
      have.add(dep);
      ids.push(dep);
      neededFor.set(dep, neededFor.get(id) ?? id);
    }
  }
  return { ids, neededFor };
}

/**
 * Order chosen nodes so every node comes after the chosen nodes it depends on, also through
 * candidates that were not chosen (stable for ties).
 */
export function orderByDependencies(chosen: string[], candidates: Map<string, PlanCandidate>): string[] {
  const chosenSet = new Set(chosen);
  const visited = new Set<string>();
  const out: string[] = [];
  const visit = (id: string, stack: Set<string>) => {
    if (visited.has(id) || stack.has(id)) return;
    stack.add(id);
    for (const dep of candidates.get(id)?.dependsOn ?? []) visit(dep, stack);
    stack.delete(id);
    visited.add(id);
    if (chosenSet.has(id)) out.push(id);
  };
  for (const id of chosen) visit(id, new Set());
  return out;
}

export interface RoadmapIdea {
  id: string;
  /** Minutes the plan gives the idea. */
  minutes: number;
  /** The ideas of the plan it is built on: they come first. */
  dependsOn: string[];
  /** Higher comes earlier among ideas that could come in either order; at the same weight, the order given decides. */
  weight: number;
}

/**
 * The ideas of a plan in an order they can be learned in (what an idea is built on comes before it),
 * laid end to end over sessions of `sessionMinutes`. It is a rough roadmap for the learner to read;
 * the planner still picks each real session when it starts. Returns, per idea and in learning order,
 * the session it starts in and the one it ends in (from 1): an idea longer than what is left of a
 * session runs on into the next.
 */
export function roadmap(ideas: RoadmapIdea[], sessionMinutes: number): Map<string, { from: number; to: number }> {
  const byId = new Map(ideas.map((i) => [i.id, i]));
  // ties go by the order the ideas came in, never by their ids: ids are random, so the plan would read differently each time
  const given = new Map(ideas.map((i, at) => [i.id, at]));
  const firstByWeight = (a: RoadmapIdea, b: RoadmapIdea) => b.weight - a.weight || (given.get(a.id) ?? 0) - (given.get(b.id) ?? 0);
  const ordered: RoadmapIdea[] = [];
  const placed = new Set<string>();
  const visit = (idea: RoadmapIdea, stack: Set<string>) => {
    if (placed.has(idea.id) || stack.has(idea.id)) return;
    stack.add(idea.id);
    for (const dep of idea.dependsOn.map((id) => byId.get(id)).filter((d): d is RoadmapIdea => d !== undefined).sort(firstByWeight)) visit(dep, stack);
    stack.delete(idea.id);
    placed.add(idea.id);
    ordered.push(idea);
  };
  for (const idea of [...ideas].sort(firstByWeight)) visit(idea, new Set());
  const sessions = new Map<string, { from: number; to: number }>();
  let at = 0;
  for (const idea of ordered) {
    const end = at + Math.max(0, idea.minutes);
    const from = Math.floor(at / sessionMinutes) + 1;
    sessions.set(idea.id, { from, to: Math.max(from, Math.ceil(end / sessionMinutes)) });
    at = end;
  }
  return sessions;
}


