/**
 * Hover definitions (R8 E2, design §8): the names the window underlines, and what the popover shows
 * for one of them. The index is the ideas the learner has learned (depth 1 or more) or keeps a
 * flashcard on (not suspended), with their names and other names; it is built once per change of the
 * data and the window matches text against it (`core/terms.ts`).
 */
import { createHash } from 'node:crypto';
import type { TermSource } from '../core/terms';
import { PASS_SCORE } from '../core/types';
import type { Depth } from '../core/types';
import type { Database } from '../store/db';
import { listCards } from '../store/cards';
import { getState, listEvidenceForNode, listStates } from '../store/evidence';
import { listCapabilities, listGoals, listTargets } from '../store/goals';
import { cachedRead } from '../store/readCache';
import { getSetting, setSetting } from '../store/settingsTable';
import { getSource } from '../store/sources';
import { getNode, getNodes, listNodes } from '../store/world';
import { worldGraph } from './worldGraph';

export interface TermsIndexView {
  /** Changes whenever the index does; the window asks again with it and gets null while it holds. */
  version: string;
  terms: TermSource[];
}

/** The index of names, or null when it is still the one the window has (`since`). */
export function termsIndex(db: Database, since?: string): TermsIndexView | null {
  const view = cachedRead(db, 'terms.index', () => {
    const states = listStates(db);
    const carded = new Set(listCards(db).filter((c) => c.suspendedAt === null).flatMap((c) => c.nodeIds));
    const terms = listNodes(db)
      .filter((n) => (states.get(n.id)?.depth ?? 0) >= 1 || carded.has(n.id))
      .map((n) => ({ id: n.id, names: [n.name, ...n.aliases] }));
    const version = createHash('sha1').update(JSON.stringify(terms)).digest('hex').slice(0, 16);
    return { version, terms };
  });
  return since && since === view.version ? null : view;
}

/** What the popover shows for one idea: short, and only what helps to follow a text. */
export interface TermPeek {
  nodeId: string;
  name: string;
  /** The learner's own wording when they wrote one, else the idea's statement. */
  definition: string;
  ownWords: boolean;
  /** How far the learner got; null when they only keep a flashcard on it. */
  learned: { depth: Depth; on: string | null } | null;
  builtOn: string[];
  leadsTo: string[];
  /** Goals that target it. */
  goals: string[];
  /** The session that first taught it, for its trail. */
  firstSession: { id: string; on: string } | null;
  /** Sources that state it, with the page, to open in the viewer. */
  sources: { sourceId: string; title: string; locator: string | null }[];
  cards: { id: string; front: string; back: string }[];
}

const FEW = 4;

export function termPeek(db: Database, nodeId: string): TermPeek {
  const node = getNode(db, nodeId);
  if (!node) throw new Error('This idea is no longer on your map.');
  const state = getState(db, nodeId);
  const graph = worldGraph(db);
  const names = (ids: Iterable<string>) => [...getNodes(db, [...ids].slice(0, 12)).values()].map((n) => n.name).slice(0, FEW);
  const premises = new Set((graph.index.into.get(nodeId) ?? []).flatMap((c) => c.premises));
  const dependents = new Set((graph.index.outOf.get(nodeId) ?? []).map((c) => c.conclusion));
  const evidence = listEvidenceForNode(db, nodeId);
  const firstPass = evidence.filter((e) => e.score >= PASS_SCORE && !e.context.implicit).map((e) => e.at).sort()[0] ?? null;
  const taughtIn = state?.firstSessionId ?? evidence.find((e) => e.sessionId)?.sessionId ?? null;
  const taughtOn = taughtIn ? (evidence.find((e) => e.sessionId === taughtIn)?.at ?? null) : null;
  const goalOf = new Map(listCapabilities(db).map((c) => [c.id, c.goalId]));
  const goalIds = new Set(listTargets(db).filter((t) => t.nodeId === nodeId).map((t) => goalOf.get(t.capabilityId)));
  const goals = listGoals(db)
    .filter((g) => goalIds.has(g.id) && g.status !== 'draft')
    .map((g) => g.title ?? g.text);
  const sources = node.sources.flatMap((ref) => {
    const source = getSource(db, ref.sourceId);
    return source && source.kind !== 'session' ? [{ sourceId: source.id, title: source.title, locator: ref.locator ?? null }] : [];
  });
  const cards = listCards(db)
    .filter((c) => c.suspendedAt === null && c.nodeIds.includes(nodeId))
    .slice(0, 3)
    .map((c) => ({ id: c.id, front: c.front, back: c.back }));
  const depth = (state?.depth ?? 0) as Depth;
  return {
    nodeId,
    name: node.name,
    definition: state?.ownStatement ?? node.statement,
    ownWords: Boolean(state?.ownStatement),
    learned: depth >= 1 ? { depth, on: firstPass } : null,
    builtOn: names(premises),
    leadsTo: names(dependents),
    goals,
    firstSession: taughtIn && taughtOn ? { id: taughtIn, on: taughtOn } : null,
    sources: sources.slice(0, 3),
    cards,
  };
}

const SHOW_KEY = 'terms.hover';

/** "Show definitions on hover" (Settings): on unless turned off. */
export function termsPreference(db: Database): { show: boolean } {
  return { show: getSetting(db, SHOW_KEY) !== 'off' };
}

export function saveTermsPreference(db: Database, show: boolean): { show: boolean } {
  setSetting(db, SHOW_KEY, show ? 'on' : 'off');
  return termsPreference(db);
}
