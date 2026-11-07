/**
 * Goals (design §3): a goal with its kind, assessment and material; an incremental compile into
 * capabilities and targets scoped to the goal's own material; the exam profile and course plan; and a
 * small worker that reads new material, profiles it and recompiles when material arrives.
 */
import { runGoalCompiler } from '../agents/goalCompiler';
import type { CompileResult, ExistingCapability, GoalCompilerInput, GraphSummaryEntry } from '../agents/goalCompiler';
import { guessMaterialRole, runCourseProfile } from '../agents/materials';
import { ancestors } from '../core/graph';
import { centrality } from '../core/leverage';
import { depthSkew, remapCauses, sameRemap, skillStatus } from '../core/goals';
import type { SkillStatus } from '../core/goals';
import { EXTRACTED_ROLES } from '../core/types';
import type { Capability, Depth, Goal, KnowledgeNode, MaterialRole, Source, Target } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { getState } from '../store/evidence';
import {
  addCapabilities,
  addExtraMinutes,
  addTargets,
  approveGoal,
  approvePlannedDepths,
  capTargets,
  clearApprovedDepths,
  clearSimplified,
  createGoal,
  deleteCapabilities,
  extendBaseline,
  forgetCompiledSource,
  getGoal,
  listCapabilities,
  listGoals,
  listMaterials,
  listTargets,
  markCompiled,
  requestRemap,
  saveRemap,
  saveCoverage,
  saveProfile,
  setMaterials,
  updateGoal,
} from '../store/goals';
import type { GoalInput, NewTarget } from '../store/goals';
import { logEvent } from '../store/activity';
import { newId } from '../store/ids';
import { coveredNodeIds, getSource, listChunks } from '../store/sources';
import { createUnverifiedNodes, getNodes } from '../store/world';
import { ideaMinutes } from '../core/budget';
import { attributeTime, goalBudgetMinutes, goalProgress, learnerSpeedNow, spentByGoal } from './budget';
import type { GoalProgress } from './budget';
import { loadKnowledge, refreshGoalFields } from './knowledge';
import { candidatesForGoal } from './planner';
import { goalSchedule } from './practice';
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

export type GoalWorkState = { state: 'idle' } | { state: 'reading' | 'profiling' | 'compiling'; message: string } | { state: 'failed'; message: string };

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
  /** Time against the budget, ideas against the plan, and pace; null until the goal is compiled. */
  progress: GoalProgress | null;
  work: GoalWorkState;
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
        return { ...t, name: node?.name ?? t.nodeId, kind: node?.kind ?? 'claim', status: node?.status ?? 'verified', currentDepth: getState(db, t.nodeId)?.depth ?? 0 };
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
    }
  });
  refreshGoalFields(db);
  if (retimed && before?.status === 'active') approvePlannedDepths(db, goalId);
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
export function simplifyIdea(db: Database, goalId: string, nodeId: string, depth: Depth, reason: string): Map<string, Depth> {
  const view = loadKnowledge(db);
  const name = view.nodes.get(nodeId)?.name ?? nodeId;
  const planned = new Map<string, number>();
  for (const t of listTargets(db, goalId)) planned.set(t.nodeId, Math.max(planned.get(t.nodeId) ?? 0, t.depth));
  const changed = new Map<string, Depth>([[nodeId, depth]]);
  for (const chain of view.index.outOf.get(nodeId) ?? []) if ((planned.get(chain.conclusion) ?? 0) > SIMPLE_DEPTH) changed.set(chain.conclusion, SIMPLE_DEPTH);
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
function recordBaseline(db: Database, goalId: string): void {
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

/** Sources whose text is read into ideas for this goal (teaching and reference material). */
export function extractedSources(db: Database, goalId: string): string[] {
  return listMaterials(db, goalId)
    .filter((m) => EXTRACTED_ROLES.includes(m.role))
    .map((m) => m.sourceId);
}

/** How many ideas from outside the goal's material (known, or in other goals) the compiler sees. */
const SHARED_IN_COMPILE = 60;

export interface CompileOptions {
  db: Database;
  provider: LlmProvider;
}

/** What the compiler sees for a goal: its material's ideas and premises, what the learner knows elsewhere, its fields and time. */
export function compileInput(db: Database, goal: Goal): { input: GoalCompilerInput; sources: string[] } {
  const goalId = goal.id;
  const materials = listMaterials(db, goalId);
  const sources = extractedSources(db, goalId);
  const view = loadKnowledge(db);

  const inMaterial = new Set(sources.flatMap((s) => coveredNodeIds(db, s)).filter((id) => view.nodes.has(id)));
  const existingTargets = listTargets(db, goalId, { all: true });
  const scope = new Set(inMaterial);
  for (const id of inMaterial) for (const a of ancestors(id, view.index)) scope.add(a);
  for (const t of existingTargets) scope.add(t.nodeId);
  // What the learner knows and what their other goals hold, so overlap is targeted, not re-created.
  const elsewhere = new Set([...view.owned, ...listTargets(db).map((t) => t.nodeId)].filter((id) => !scope.has(id) && view.nodes.has(id)));
  const shared = [...elsewhere].sort((a, b) => centrality(b, view.index) - centrality(a, view.index) || a.localeCompare(b)).slice(0, SHARED_IN_COMPILE);
  const graph: GraphSummaryEntry[] = [...scope, ...shared]
    .map((id) => view.nodes.get(id))
    .filter((n): n is KnowledgeNode => n !== undefined)
    .map((n) => ({ id: n.id, kind: n.kind, name: n.name, statement: n.statement, inMaterial: inMaterial.has(n.id), elsewhere: elsewhere.has(n.id) ? (view.owned.has(n.id) ? 'known' : 'other goal') : undefined }));

  const existing: ExistingCapability[] = listCapabilities(db, goalId).map((c) => ({
    id: c.id,
    statement: c.statement,
    mastered: c.masteredAt !== null,
    targets: existingTargets.filter((t) => t.capabilityId === c.id).map((t) => ({ nodeId: t.nodeId, name: view.nodes.get(t.nodeId)?.name ?? t.nodeId, depth: t.idealDepth })),
  }));
  const newMaterial = sources.filter((s) => !goal.compiledSources.includes(s)).map((s) => getSource(db, s)?.title ?? s);
  const budgetTotal = goalBudgetMinutes(db, goal);
  return {
    sources,
    input: {
      goalText: goal.text,
      kind: goal.kind,
      assessment: goal.assessment,
      targetGrade: goal.targetGrade,
      date: goal.date,
      examProfile: goal.examProfile,
      graph,
      fromScratch: materials.length === 0,
      existing,
      newMaterial: existing.length ? newMaterial : [],
      budgetHours: budgetTotal === null ? null : budgetTotal / 60,
      wantedLevel: goal.wantedLevel,
      spentHours: (spentByGoal(attributeTime(db)).get(goalId) ?? 0) / 60,
      focus: goal.focus,
      askCoverage: goal.coverage === null && sources.length > 0,
      background: goal.background,
      context: goal.context,
      level: goal.level,
    },
  };
}

/** What a compile writes; a re-map's proposal has the same shape (without extensions or retirements). */
export type CompileOutput = Pick<CompileResult, 'title' | 'level' | 'scope' | 'coverage' | 'capabilities' | 'extend' | 'retire' | 'newNodes'>;

/**
 * Write a compile: new nodes, retirements, extensions and new capabilities, then the goal's title,
 * level and scope. `replace` drops every existing capability first (a re-map draws the map anew).
 * No re-plan; the caller refreshes.
 */
export function applyCompile(db: Database, goal: Goal, result: CompileOutput, sources: string[], options: { replace?: boolean } = {}): void {
  const goalId = goal.id;
  const tempToId = new Map<string, string>();
  const created = result.newNodes.map((n) => {
    const id = newId('node');
    tempToId.set(n.tempId, id);
    return { id, kind: n.kind, name: n.name, statement: n.statement, aliases: [] };
  });
  if (created.length) createUnverifiedNodes(db, created);
  const resolve = (targets: { ref: string; depth: number; core: boolean }[]) => dedupeTargets(targets.map((t) => ({ nodeId: tempToId.get(t.ref) ?? t.ref, depth: t.depth as Depth, core: t.core })));
  if (options.replace) deleteCapabilities(db, listCapabilities(db, goalId).map((c) => c.id));
  deleteCapabilities(db, result.retire);
  for (const e of result.extend) if (!result.retire.includes(e.capabilityId)) addTargets(db, e.capabilityId, resolve(e.targets));
  addCapabilities(
    db,
    goalId,
    result.capabilities.map((c) => ({ statement: c.statement, targets: resolve(c.targets) })),
  );
  markCompiled(
    db,
    goalId,
    result.title,
    sources.filter((s) => getSource(db, s)?.status === 'done' || goal.compiledSources.includes(s)),
    // with no time limit the goal's level is the one the learner chose
    { level: goal.wantedLevel ?? result.level, scope: result.scope },
  );
  if (result.coverage) saveCoverage(db, goalId, result.coverage);
  if (goal.status !== 'draft') recordBaseline(db, goalId);
}

/**
 * Compile incrementally: the compiler sees the goal's own material (plus the premises its ideas are
 * built on) and the existing capabilities, adds what is new and leaves existing capabilities, their ids
 * and mastery alone unless one is clearly superseded.
 */
export async function compileGoal(options: CompileOptions, goalId: string): Promise<GoalDetail> {
  const { db, provider } = options;
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`unknown goal ${goalId}`);
  const { input, sources } = compileInput(db, goal);
  const result = await runGoalCompiler(provider, input);
  transaction(db, () => {
    applyCompile(db, goal, result, sources);
    // a draft's first map read the goal as it is now, so a change asked for before it began is answered
    const now = getGoal(db, goalId);
    if (goal.status === 'draft' && input.existing.length === 0 && goal.remap?.state === 'requested' && now && sameRemap(now.remap, goal.remap)) saveRemap(db, goalId, null);
  });

  const skew = depthSkew(listTargets(db, goalId).map((t) => t.depth));
  if (skew.overTargeted) console.warn(`goal ${goalId}: ${Math.round(skew.deepShare * 100)}% of targets are at depth 3 or more; the compiler is over-targeting`);
  refreshGoalFields(db);
  // ideas a recompile adds to an active goal join its approved plan at the depth the plan gives them
  if (goal.status === 'active') approvePlannedDepths(db, goalId);
  return goalDetail(db, goalId) as GoalDetail;
}

/** Summarize assessment material into the exam profile and scope material into the course plan. */
export async function profileGoal(options: CompileOptions, goalId: string): Promise<void> {
  const { db, provider } = options;
  const goal = getGoal(db, goalId);
  if (!goal) return;
  const materials = listMaterials(db, goalId);
  const textOf = (sourceId: string) => ({ title: getSource(db, sourceId)?.title ?? sourceId, text: listChunks(db, sourceId).map((c) => c.text).join('\n\n') });
  const assessment = materials.filter((m) => m.role === 'assessment');
  const scope = materials.filter((m) => m.role === 'scope');
  const used = [...assessment, ...scope].map((m) => m.sourceId);
  if (used.length === 0) {
    saveProfile(db, goalId, null, [], []);
    return;
  }
  const profile = await runCourseProfile(provider, {
    goalText: goal.text,
    assessment: goal.assessment,
    date: goal.date,
    assessmentMaterials: assessment.map((m) => textOf(m.sourceId)),
    scopeMaterials: scope.map((m) => textOf(m.sourceId)),
    teachingTitles: materials.filter((m) => m.role === 'teaching').map((m) => getSource(db, m.sourceId)?.title ?? m.sourceId),
  });
  saveProfile(db, goalId, profile.examProfile, profile.upcoming, used);
}

/** Guess the role of a file added to a goal from its first chunks. */
export async function guessRole(db: Database, provider: LlmProvider, sourceId: string): Promise<{ role: MaterialRole; reason: string }> {
  const source = getSource(db, sourceId);
  const text = listChunks(db, sourceId)
    .slice(0, 3)
    .map((c) => c.text)
    .join('\n\n');
  return guessMaterialRole(provider, { title: source?.title ?? '', text });
}

function dedupeTargets(targets: NewTarget[]): NewTarget[] {
  const best = new Map<string, NewTarget>();
  for (const t of targets) {
    const prev = best.get(t.nodeId);
    best.set(t.nodeId, { nodeId: t.nodeId, depth: Math.max(prev?.depth ?? 0, t.depth) as Depth, core: Boolean(prev?.core || t.core) });
  }
  return [...best.values()];
}
