/**
 * "Describe it" (design §4.5): the session maker turns what the learner wants to learn into a session's
 * ideas. The call runs in the background and its result waits here, as a proposal, until the learner
 * starts it or asks again; closing the sheet does not stop it.
 */
import { runSessionMaker } from '../agents/sessionMaker';
import type { MakerIdea, SessionMakerResult } from '../agents/sessionMaker';
import { SESSION_MINUTES } from '../core/budget';
import { centrality } from '../core/leverage';
import { nowIso } from '../store/db';
import { getGoal, listTargets } from '../store/goals';
import { newId } from '../store/ids';
import { learnerSpeedNow } from './budget';
import { loadKnowledge } from './knowledge';
import { searchIdeas } from './lookup';
import type { LookupDeps } from './lookup';
import { stepMinutes } from './planner';

/** Ideas found by meaning and name, and a goal's own ideas, that the session maker may use by id. */
const MATCHES = 24;
const GOAL_IDEAS = 30;
const OWNED = 60;
export const MAX_DESCRIPTION = 2000;

export interface MakerRequest {
  description: string;
  goalId: string | null;
}

export interface MakerView {
  /** The proposal's id once it is ready: a start names it. */
  id: string;
  status: 'running' | 'ready' | 'failed';
  description: string;
  goalId: string | null;
  since: string;
  error: string | null;
}

export interface Proposal extends MakerRequest {
  id: string;
  result: SessionMakerResult;
}

export type MakerDeps = LookupDeps & Required<Pick<LookupDeps, 'provider'>>;

/** One description at a time: asking again replaces the last proposal. */
export class SessionMaker {
  private entry: { view: MakerView; result: SessionMakerResult | null } | null = null;
  private readonly listeners = new Set<(view: MakerView | null) => void>();

  current(): MakerView | null {
    return this.entry?.view ?? null;
  }

  /** The ready proposal with this id, if it is still the current one. */
  proposal(id: string): Proposal | null {
    const e = this.entry;
    return e && e.view.id === id && e.result ? { id, description: e.view.description, goalId: e.view.goalId, result: e.result } : null;
  }

  /**
   * Ask the session maker; resolves with the finished view (ready or failed, never rejected). Refused
   * at once while another description is being made.
   */
  make(deps: MakerDeps, request: MakerRequest): Promise<MakerView> {
    if (this.entry?.view.status === 'running') throw new Error('Frontier is still making your last session.');
    const description = request.description.trim();
    if (!description) throw new Error('Say what you want to learn first.');
    if (description.length > MAX_DESCRIPTION) throw new Error(`Keep it under ${MAX_DESCRIPTION} characters.`);
    if (request.goalId && !getGoal(deps.db, request.goalId)) throw new Error('That goal no longer exists.');
    const entry = { view: { id: newId('prop'), status: 'running' as MakerView['status'], description, goalId: request.goalId, since: nowIso(), error: null as string | null }, result: null as SessionMakerResult | null };
    this.entry = entry;
    this.notify();
    return (async () => {
      try {
        entry.result = await runSessionMaker(deps.provider, await makerInput(deps, description, request.goalId));
        entry.view = { ...entry.view, status: 'ready' };
      } catch (error) {
        entry.view = { ...entry.view, status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
      if (this.entry === entry) this.notify();
      return entry.view;
    })();
  }

  /** A started proposal is spent. */
  forget(id: string): void {
    if (this.entry?.view.id !== id) return;
    this.entry = null;
    this.notify();
  }

  subscribe(listener: (view: MakerView | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.current());
  }
}

/** What the session maker sees: the request, the goal, the map's matching ideas and what the learner owns. */
async function makerInput(deps: MakerDeps, description: string, goalId: string | null) {
  const { db } = deps;
  const view = loadKnowledge(db);
  const goal = goalId ? getGoal(db, goalId) : undefined;
  const hits = await searchIdeas(deps, description, MATCHES);
  const goalIdeas = goalId ? [...new Set(listTargets(db, goalId).map((t) => t.nodeId))].slice(0, GOAL_IDEAS) : [];
  const ids = [...new Set([...hits.map((h) => h.nodeId), ...goalIdeas])].filter((id) => view.nodes.has(id));
  const matches: MakerIdea[] = ids.map((id) => {
    const node = view.nodes.get(id);
    return { id, kind: node?.kind ?? 'claim', name: node?.name ?? id, statement: node?.statement ?? '', depth: view.states.get(id)?.depth ?? 0, owned: view.owned.has(id) };
  });
  const shown = new Set(ids);
  const owned = [...view.owned]
    .filter((id) => !shown.has(id))
    .sort((a, b) => centrality(b, view.index) - centrality(a, view.index) || a.localeCompare(b))
    .slice(0, OWNED)
    .map((id) => ({ id, name: view.nodes.get(id)?.name ?? id }));
  const speed = learnerSpeedNow(db);
  const minutesPerAim = { 1: stepMinutes('claim', 0, 1, speed), 2: stepMinutes('claim', 0, 2, speed), 3: stepMinutes('claim', 0, 3, speed), 4: stepMinutes('claim', 0, 4, speed) };
  return {
    description,
    goal: goal ? { text: goal.text, level: goal.level, scope: goal.scope, focus: goal.focus, background: goal.background } : null,
    matches,
    owned,
    minutesPerAim,
    sessionMinutes: SESSION_MINUTES,
  };
}
