/**
 * Goals (design §3): a goal with its kind, assessment and material, as its page shows it; creating,
 * editing, approving, pausing and removing it; simplified ideas and going deeper. Mapping a goal
 * (the compile and the exam profile) is in `goalCompile.ts`, the worker that runs it in `goalWorker.ts`.
 */
import { remapCauses, skillStatus } from '../core/goals';
import type { SkillStatus } from '../core/goals';
import type { Capability, Depth, Goal, KnowledgeNode, MaterialRole, Source, Target } from '../core/types';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { getState } from '../store/evidence';
import { addExtraMinutes, approveGoal, approvePlannedDepths, capTargets, clearApprovedDepths, clearSimplified, createGoal, deleteCapabilities, extendBaseline, forgetCompiledSource, getGoal, listCapabilities, deleteGoal, listGoals, listMaterials, listTargets, requestRemap, startUnverified, setMaterials, updateGoal, resetExtraMinutes, restartRhythm } from '../store/goals';
import type { GoalInput } from '../store/goals';
import { logEvent } from '../store/activity';
import { activeSession } from '../store/sessions';
import { coveredNodeIds, getSource } from '../store/sources';
import { getNodes } from '../store/world';
import { ideaMinutes } from '../core/budget';
import { goalProgress, learnerSpeedNow } from './budget';
import type { GoalProgress } from './budget';
import { loadKnowledge, refreshGoalFields } from './knowledge';
import { candidatesForGoal } from './planner';
import { goalSchedule, missedInPractice } from './practice';
import type { GoalSchedule } from './practice';

export interface GoalForm extends GoalInput {
  materials: { sourceId: string; role: MaterialRole }[];
}

export interface MaterialView {
  sourceId: string;
  title: string;
  role: MaterialRole;
  status: Source['status'];
  chunkCount: number;
  chunksDone: number;
  /** Ideas read from it, and how many of those the learner owns. */
  ideas: number;
  owned: number;
}

/** What the goal worker is doing for a goal; `adding` works out an addition, which shows on its own panel. */
export type GoalWorkState = { state: 'idle' } | { state: 'reading' | 'profiling' | 'compiling' | 'adding'; message: string } | { state: 'failed'; message: string };

export interface GoalDetail {
  goal: Goal;
  capabilities: (Capability & {
    status: SkillStatus;
    /** False when the time budget leaves every one of its ideas out. */
    planned: boolean;
    /** Every target; `depth` is the planned depth (0 when the budget leaves it out), `idealDepth` what the goal asks. */
    targets: (Target & { name: string; kind: KnowledgeNode['kind']; status: KnowledgeNode['status']; currentDepth: Depth })[];
  })[];
  /** Ideas simplified for this goal, and the minutes going deeper on each (and on all) would add. */
  simplified: { ideas: { nodeId: string; name: string; reason: string; minutes: number }[]; minutes: number };
  /** Targets no source covers yet ("expected, not in your material"). */
  expected: { nodeId: string; name: string; statement: string; started: boolean }[];
  materials: MaterialView[];
  /** The next ideas a session would start from, for "This week". */
  nextIdeas: string[];
  /** What the scheduler suggests today; null until the goal is compiled. */
  schedule: GoalSchedule | null;
  /** Ideas whose last practice went wrong: worth a new problem. */
  missed: { nodeId: string; name: string }[];
  /** Time against the budget, ideas against the plan, and pace; null until the goal is compiled. */
  progress: GoalProgress | null;
  work: GoalWorkState;
}

/** Every goal as its page shows it, with what the background work is doing on each. */
export function listGoalDetails(db: Database, workOf: (goalId: string) => GoalWorkState): GoalDetail[] {
  return listGoals(db).flatMap((g) => goalDetail(db, g.id, workOf(g.id)) ?? []);
}

/** Remove a goal, refused while a session on it is open. Its ideas and what was learned stay on the map. */
export function removeGoal(db: Database, goalId: string): void {
  if (activeSession(db)?.goalId === goalId) throw new Error('A session on this goal is open. End or finish it first, then remove the goal.');
  deleteGoal(db, goalId);
  refreshGoalFields(db);
}

/** The learner asked for a new map of the goal; the goal worker makes it. */
export function askForRemap(db: Database, goalId: string): void {
  requestRemap(db, goalId);
}

/** The learner chose to start an idea of the goal that no source has grounded yet. */
export function startUngrounded(db: Database, goalId: string, nodeId: string): void {
  startUnverified(db, goalId, nodeId);
}

export function goalDetail(db: Database, goalId: string, work: GoalWorkState = { state: 'idle' }): GoalDetail | undefined {
  const goal = getGoal(db, goalId);
  if (!goal) return undefined;
  const view = loadKnowledge(db);
  const targets = listTargets(db, goalId, { all: true });
  const nodes = getNodes(
    db,
    targets.map((t) => t.nodeId),
  );
  const capabilities = listCapabilities(db, goalId).map((cap) => {
    const capTargets = targets
      .filter((t) => t.capabilityId === cap.id)
      .map((t) => {
        const node = nodes.get(t.nodeId);
        return { ...t, name: node?.name ?? t.nodeId, kind: node?.kind ?? 'claim', status: node?.status ?? 'verified', currentDepth: view.states.get(t.nodeId)?.depth ?? 0 };
      });
    const planned = capTargets.filter((t) => t.depth > 0);
    return { ...cap, status: skillStatus(cap.masteredAt, planned), planned: planned.length > 0, targets: capTargets };
  });
  const expectedIds = [...new Set(targets.filter((t) => t.depth > 0).map((t) => t.nodeId))].filter((id) => nodes.get(id)?.status === 'unverified');
  const deeper = deeperMinutes(db, goalId);
  const materials = listMaterials(db, goalId).map((m) => {
    const source = getSource(db, m.sourceId);
    const covered = coveredNodeIds(db, m.sourceId);
    return {
      sourceId: m.sourceId,
      title: source?.title ?? m.sourceId,
      role: m.role,
      status: source?.status ?? 'pending',
      chunkCount: source?.chunkCount ?? 0,
      chunksDone: source?.chunksDone ?? 0,
      ideas: covered.length,
      owned: covered.filter((id) => view.owned.has(id)).length,
    };
  });
  const { candidates } = candidatesForGoal(db, goalId, view);
  return {
    goal,
    capabilities,
    expected: expectedIds.map((id) => ({ nodeId: id, name: nodes.get(id)?.name ?? id, statement: nodes.get(id)?.statement ?? '', started: goal.startedUnverified.includes(id) })),
    materials,
    nextIdeas: candidates.filter((c) => c.onFringe).slice(0, 3).map((c) => view.nodes.get(c.nodeId)?.name ?? c.nodeId),
    simplified: deeper,
    schedule: capabilities.length && goal.status === 'active' ? goalSchedule(db, goalId) : null,
    missed: capabilities.length && goal.status === 'active' ? missedInPractice(db, goalId) : [],
    progress: capabilities.length ? goalProgress(db, goalId) : null,
    work,
  };
}

/** A new goal; as a draft it is compiled and previewed, and becomes active once its plan is approved. */
export function createGoalFromForm(db: Database, form: GoalForm, options: { draft?: boolean } = {}): Goal {
  return transaction(db, () => {
    const goal = createGoal(db, form, { draft: options.draft });
    setMaterials(db, goal.id, form.materials);
    logEvent(db, 'goal.created', { goalId: goal.id }, { budget: form.budget ?? null, draft: options.draft ?? false });
    for (const m of form.materials) logEvent(db, 'material.added', { goalId: goal.id, sourceId: m.sourceId }, { role: m.role });
    return goal;
  });
}

/**
 * Save an edit. A new time (or a switch to no time limit) re-plans at once. A change to what the map
 * is drawn around (the context, how deep the goal goes) asks for a new map: a mapped goal gets a
 * proposal to approve (design §3.2, step 7a); a draft, with nothing approved yet, is simply mapped again.
 */
export function updateGoalFromForm(db: Database, goalId: string, form: Partial<GoalForm>): void {
  const before = getGoal(db, goalId);
  let retimed = false;
  transaction(db, () => {
    const { materials, ...fields } = form;
    updateGoal(db, goalId, fields);
    const after = getGoal(db, goalId);
    retimed = JSON.stringify(after?.budget ?? null) !== JSON.stringify(before?.budget ?? null) || after?.wantedLevel !== before?.wantedLevel;
    const causes = before && after ? remapCauses(before, after) : [];
    // a draft not mapped yet may be mapping right now from what it said before, so it asks too
    if (causes.length && before && (before.status === 'draft' || before.compiledAt !== null)) requestRemap(db, goalId, causes);
    if (materials) {
      const had = new Set(listMaterials(db, goalId).map((m) => m.sourceId));
      setMaterials(db, goalId, materials);
      for (const m of materials) if (!had.has(m.sourceId)) logEvent(db, 'material.added', { goalId, sourceId: m.sourceId }, { role: m.role });
    }
    if (retimed) {
      logEvent(db, 'budget.changed', { goalId }, { from: before?.budget ?? null, to: after?.budget ?? null, ...(after?.wantedLevel !== before?.wantedLevel ? { fromLevel: before?.wantedLevel ?? null, toLevel: after?.wantedLevel ?? null } : {}) });
      // a new time is a new plan to approve: it re-plans from the ideal depths
      clearApprovedDepths(db, goalId);
      // it replaces the time as it was, including minutes that going deeper had added, and its rhythm starts now
      resetExtraMinutes(db, goalId);
      if (before?.status !== 'draft') restartRhythm(db, goalId);
    }
  });
  refreshGoalFields(db);
  if (retimed && before?.status === 'active') approvePlannedDepths(db, goalId);
}

/**
 * Use time the approved plan no longer needs (design §3.4): the plan is approved again from the
 * goal's ideal depths for the same time, so ideas it had left out or kept shallow come back as far as
 * the time holds. Simplified ideas stay as they were learned; going deeper on them is its own choice.
 */
export function useFreedTime(db: Database, goalId: string): void {
  const goal = getGoal(db, goalId);
  if (!goal || goal.status !== 'active') throw new Error('Only a goal you are learning now can take more into its plan.');
  clearApprovedDepths(db, goalId);
  refreshGoalFields(db);
  approvePlannedDepths(db, goalId);
  logEvent(db, 'goal.extended', { goalId }, { freedTime: true });
}

/**
 * Pause, finish or take up a goal again. A paused or finished goal keeps everything (its map, its
 * time, its flashcards) but is left out of Today, of the scheduler and of the shared plan, so its
 * ideas no longer take a share of other goals' time. A draft has no plan yet, so it has no state to set.
 */
export function setGoalStatus(db: Database, goalId: string, status: 'active' | 'paused' | 'done'): void {
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error('This goal no longer exists.');
  if (goal.status === 'draft') throw new Error('Approve the plan of this goal first.');
  if (goal.status === status) return;
  transaction(db, () => {
    updateGoal(db, goalId, { status });
    // taken up again: the weeks it rested do not count as weeks it fell behind
    if (status === 'active') restartRhythm(db, goalId);
    logEvent(db, 'goal.status', { goalId }, { from: goal.status, to: status });
  });
  refreshGoalFields(db);
}

/**
 * The learner approved a draft's plan: it becomes active, its clock starts, and what they know now is
 * its baseline (progress counts from here). Its ideas join the shared plan of all goals.
 */
export function approveGoalPlan(db: Database, goalId: string): void {
  transaction(db, () => {
    approveGoal(db, goalId);
    recordBaseline(db, goalId);
    logEvent(db, 'goal.approved', { goalId }, { budget: getGoal(db, goalId)?.budget ?? null });
  });
  refreshGoalFields(db);
  approvePlannedDepths(db, goalId);
}

/** A simplified idea aims to be explained; its dependents can then be explained, not derived. */
const SIMPLE_DEPTH: Depth = 2;

/**
 * Simplify an idea for a goal (design §4.3): the learner is missing what it needs, or its half hour
 * ran out. The goal's targets on it are capped at `depth` with the reason, and so are the goal's ideas
 * that use it as a direct premise and are planned to be derived or deeper (a derivation cannot rest on
 * an intuition): they are capped at explaining. Returns every idea that changed, with its new cap.
 */
export function simplifyIdea(db: Database, goalId: string, nodeId: string, depth: Depth, reason: string, options: { dependents: boolean } = { dependents: true }): Map<string, Depth> {
  const view = loadKnowledge(db);
  const name = view.nodes.get(nodeId)?.name ?? nodeId;
  const planned = new Map<string, number>();
  for (const t of listTargets(db, goalId)) planned.set(t.nodeId, Math.max(planned.get(t.nodeId) ?? 0, t.depth));
  // An idea that only ended below what was asked: this goal's own plan is what counts. When this goal
  // asks no more than was reached (another goal asked for the rest), there is nothing to mark here.
  if (!options.dependents && (planned.get(nodeId) ?? 0) <= depth) return new Map();
  const changed = new Map<string, Depth>([[nodeId, depth]]);
  // the ideas built directly on it are capped too only when it was taught as its core intuition
  if (options.dependents) for (const chain of view.index.outOf.get(nodeId) ?? []) if ((planned.get(chain.conclusion) ?? 0) > SIMPLE_DEPTH) changed.set(chain.conclusion, SIMPLE_DEPTH);
  transaction(db, () => {
    for (const [id, cap] of changed) capTargets(db, goalId, id, cap, id === nodeId ? reason : `Simplified with ${name}`);
  });
  refreshGoalFields(db);
  return changed;
}

/** Going deeper costs at least this much, so the time it adds is visible and worth a session. */
const MIN_DEEPER_MINUTES = 5;

/**
 * What going deeper on a goal's simplified ideas would take (design §3.4): for each, the cost model's
 * minutes from what the learner knows to the depth the goal asks, at this learner's speed, rounded up to
 * five minutes; and in all.
 */
export function deeperMinutes(db: Database, goalId: string, only?: string[]): { ideas: { nodeId: string; name: string; reason: string; minutes: number }[]; minutes: number } {
  const ideal = new Map<string, { depth: number; reason: string }>();
  for (const t of listTargets(db, goalId, { all: true })) {
    if (!t.simplified || (only && !only.includes(t.nodeId))) continue;
    const prev = ideal.get(t.nodeId);
    ideal.set(t.nodeId, { depth: Math.max(prev?.depth ?? 0, t.idealDepth), reason: prev?.reason ?? t.simplified });
  }
  if (ideal.size === 0) return { ideas: [], minutes: 0 };
  const speed = learnerSpeedNow(db);
  const nodes = getNodes(db, [...ideal.keys()]);
  const ideas = [...ideal.entries()].map(([nodeId, { depth, reason }]) => {
    const node = nodes.get(nodeId);
    const raw = ideaMinutes(node?.kind ?? 'claim', getState(db, nodeId)?.depth ?? 0, depth, speed);
    return { nodeId, name: node?.name ?? nodeId, reason, minutes: Math.max(MIN_DEEPER_MINUTES, Math.ceil(raw / 5) * 5) };
  });
  return { ideas, minutes: ideas.reduce((sum, i) => sum + i.minutes, 0) };
}

/**
 * Go deeper on simplified ideas (all of the goal's, or the given ones): their time is added to the
 * goal, on top of what the learner gave it, so the rest of the plan stays; the ideas are no longer
 * simplified and the plan may take them to the depth the goal asks. The caller starts a session on them.
 */
export function goDeeper(db: Database, goalId: string, nodeIds?: string[]): { minutes: number; nodeIds: string[] } {
  if (activeSession(db)) throw new Error('Finish or end the open session first, then go deeper.');
  const { ideas, minutes } = deeperMinutes(db, goalId, nodeIds);
  if (ideas.length === 0) return { minutes: 0, nodeIds: [] };
  const ids = ideas.map((i) => i.nodeId);
  transaction(db, () => {
    addExtraMinutes(db, goalId, minutes);
    clearSimplified(db, goalId, ids);
    logEvent(db, 'budget.changed', { goalId }, { deeper: ids, addedMinutes: minutes });
  });
  refreshGoalFields(db);
  return { minutes, nodeIds: ids };
}

/** Add the current depth of every idea the goal targets that is not in its baseline yet. */
export function recordBaseline(db: Database, goalId: string): void {
  const depths: Record<string, Depth> = {};
  for (const t of listTargets(db, goalId, { all: true })) depths[t.nodeId] = getState(db, t.nodeId)?.depth ?? 0;
  extendBaseline(db, goalId, depths);
}

/**
 * A source was read again into larger ideas and some of its old ideas retired (their targets went with
 * them). Every goal that uses it compiles it afresh once it is read, and drops the capabilities left
 * with no ideas, unless mastered.
 */
export function afterSourceReread(db: Database, sourceId: string): void {
  for (const goal of listGoals(db)) {
    if (!listMaterials(db, goal.id).some((m) => m.sourceId === sourceId)) continue;
    const targeted = new Set(listTargets(db, goal.id, { all: true }).map((t) => t.capabilityId));
    deleteCapabilities(
      db,
      listCapabilities(db, goal.id)
        .filter((c) => c.masteredAt === null && !targeted.has(c.id))
        .map((c) => c.id),
    );
    forgetCompiledSource(db, goal.id, sourceId);
  }
}
