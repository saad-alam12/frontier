/**
 * The Map screen's data and the node card shared by Map and Lookup (design §8): every idea with the
 * learner's depth, freshness and place relative to the edge, the chains between ideas, and for one
 * idea everything known about it, including the derivation path from what the learner owns.
 */
import { derivationPath } from '../core/derivation';
import { topics } from '../core/clusters';
import { cachedForWorld } from '../store/readCache';
import { recallProbability } from '../core/fsrs';
import { PASS_SCORE } from '../core/types';
import type { Depth, KnowledgeNode, Tier } from '../core/types';
import type { Database } from '../store/db';
import { listBugsForNode } from '../store/bugs';
import { ideaNotesFor } from '../store/ideaNotes';
import { cardCountsByNode } from '../store/cards';
import { firstPasses } from '../store/evidence';
import { listGoals, listTargets } from '../store/goals';
import { getSession } from '../store/sessions';
import { getSource } from '../store/sources';
import { deeperMinutes } from './goals';
import { loadKnowledge } from './knowledge';
import type { IdeaRef } from './library';
import type { SessionState } from './sessionState';

export type MapState = 'owned' | 'fringe' | 'beyond';

export interface MapNodeView {
  id: string;
  name: string;
  kind: KnowledgeNode['kind'];
  state: MapState;
  depth: Depth;
  /** Recall probability now; 0 for ideas never reviewed. */
  recall: number;
  unverified: boolean;
  /** Goals that target this idea. */
  goals: string[];
  /** An active goal simplified it (taught as its core intuition). */
  simplified: boolean;
  /** The group of ideas it hangs together with through chains (null when its group is small). */
  topic: string | null;
  /** When the learner first showed it at some depth; null when not yet. */
  learnedAt: string | null;
  /** Flashcards tagged with it. */
  cards: number;
}

export interface MapView {
  nodes: MapNodeView[];
  chains: { id: string; premises: string[]; conclusion: string }[];
  goals: { id: string; title: string }[];
  /** Groups of ideas that hang together through chains, largest first, named after their most central idea. */
  topics: { id: string; name: string; size: number }[];
  counts: Record<MapState, number>;
}

export function mapView(db: Database, now = new Date()): MapView {
  const view = loadKnowledge(db, now);
  const goals = listGoals(db).filter((g) => g.status === 'active');
  const targetGoals = new Map<string, string[]>();
  const simplified = new Set<string>();
  for (const t of listTargets(db, undefined, { all: true })) {
    const goalId = view.goals.capabilities.get(t.capabilityId)?.goalId;
    if (!goalId || !goals.some((g) => g.id === goalId)) continue;
    if (t.simplified) simplified.add(t.nodeId);
    if (t.depth > 0) targetGoals.set(t.nodeId, [...new Set([...(targetGoals.get(t.nodeId) ?? []), goalId])]);
  }
  // topics come from the graph alone: worked out again only when the map changes
  const groups = cachedForWorld(db, 'map.topics', () =>
    topics(
      [...view.nodes.keys()],
      view.index,
      new Map([...view.nodes.values()].map((n) => [n.id, n.name])),
      view.centrality,
    ).sort((a, b) => b.nodeIds.length - a.nodeIds.length),
  );
  const topicOf = new Map<string, string>();
  for (const t of groups) for (const id of t.nodeIds) topicOf.set(id, t.id);
  const learned = firstPasses(db, PASS_SCORE);
  const cardCounts = cardCountsByNode(db);
  const nodes: MapNodeView[] = [...view.nodes.values()].map((n) => {
    const state = view.states.get(n.id);
    return {
      id: n.id,
      name: n.name,
      kind: n.kind,
      state: view.owned.has(n.id) ? 'owned' : view.fringe.has(n.id) ? 'fringe' : 'beyond',
      depth: state?.depth ?? 0,
      recall: state ? recallProbability(state.fsrs, now) : 0,
      unverified: n.status === 'unverified',
      goals: targetGoals.get(n.id) ?? [],
      simplified: simplified.has(n.id),
      topic: topicOf.get(n.id) ?? null,
      learnedAt: learned.get(n.id) ?? null,
      cards: cardCounts.get(n.id) ?? 0,
    };
  });
  const counts: Record<MapState, number> = { owned: 0, fringe: 0, beyond: 0 };
  for (const n of nodes) counts[n.state] += 1;
  return {
    nodes,
    chains: view.chains.map((c) => ({ id: c.id, premises: c.premises, conclusion: c.conclusion })),
    goals: goals.map((g) => ({ id: g.id, title: g.title ?? g.text })),
    topics: groups.map((t) => ({ id: t.id, name: t.name, size: t.nodeIds.length })),
    counts,
  };
}

export interface NodeCard {
  id: string;
  name: string;
  kind: KnowledgeNode['kind'];
  statement: string;
  unverified: boolean;
  state: MapState;
  depth: Depth;
  targetDepth: Depth;
  recall: number;
  tier: Tier;
  ownStatement: string | null;
  handle: string | null;
  /** The learner's free note on it. */
  note: string | null;
  /** One entry per chain into this idea (alternative arguments are separate). */
  builtOn: IdeaRef[][];
  leadsTo: IdeaRef[];
  /** From owned ideas down to this one, grounds first. */
  derivation: (IdeaRef & { owned: boolean; premises: IdeaRef[] })[];
  /** Where the idea comes from; `viewable` when the source is in the library (not a past session) and opens in the viewer. */
  sources: { sourceId: string; title: string; locator: string | null; viewable: boolean }[];
  bugs: string[];
  /** The session where it was first taught, for the trail link. */
  firstSession: { id: string; date: string; title: string } | null;
  /** Goals that simplified it (taught as its core intuition), why, and what going deeper would add. */
  simplified: { goalId: string; goalTitle: string; reason: string; minutes: number }[];
}

/** An idea a chosen session brought in is cited to that session (design §4.5). */
function sessionCitation(db: Database, sessionId: string): string | null {
  const session = getSession<SessionState>(db, sessionId);
  return session ? `your session of ${new Date(session.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` : null;
}

export function nodeCard(db: Database, nodeId: string, now = new Date()): NodeCard {
  const view = loadKnowledge(db, now);
  const node = view.nodes.get(nodeId);
  if (!node) throw new Error(`unknown idea ${nodeId}`);
  const state = view.states.get(nodeId);
  const ref = (id: string): IdeaRef => ({ id, name: view.nodes.get(id)?.name ?? id });
  const session = state?.firstSessionId ? getSession<SessionState>(db, state.firstSessionId) : undefined;
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    statement: node.statement,
    unverified: node.status === 'unverified',
    state: view.owned.has(node.id) ? 'owned' : view.fringe.has(node.id) ? 'fringe' : 'beyond',
    depth: state?.depth ?? 0,
    targetDepth: state?.targetDepth ?? 0,
    recall: state ? recallProbability(state.fsrs, now) : 0,
    tier: state?.tier ?? 'archive',
    ownStatement: state?.ownStatement ?? null,
    note: ideaNotesFor(db, [node.id]).get(node.id) ?? null,
    handle: state?.handle ?? null,
    builtOn: (view.index.into.get(node.id) ?? []).map((c) => c.premises.map(ref)),
    leadsTo: [...new Set((view.index.outOf.get(node.id) ?? []).map((c) => c.conclusion))].map(ref),
    derivation: derivationPath(node.id, view.index, view.owned).map((s) => ({ ...ref(s.nodeId), owned: s.owned, premises: s.premises.map(ref) })),
    sources: node.sources.map((s) => {
      const source = getSource(db, s.sourceId);
      return { sourceId: s.sourceId, title: source?.title ?? sessionCitation(db, s.sourceId) ?? 'A source', locator: s.locator ?? null, viewable: source !== undefined && source.kind !== 'session' };
    }),
    bugs: listBugsForNode(db, node.id).map((b) => b.description),
    firstSession: session ? { id: session.id, date: session.startedAt.slice(0, 10), title: session.state.plan?.title ?? 'Session' } : null,
    simplified: listGoals(db)
      .filter((g) => g.status === 'active')
      .flatMap((g) => {
        const idea = deeperMinutes(db, g.id, [nodeId]).ideas[0];
        return idea ? [{ goalId: g.id, goalTitle: g.title ?? g.text, reason: idea.reason, minutes: idea.minutes }] : [];
      }),
  };
}
