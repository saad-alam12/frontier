/**
 * Mapping a goal (design §3): the goal compiler's input from the goal, its material and what is known,
 * then its answer applied as capabilities, targets and new ideas; the exam's profile; and what a file
 * offered as material is for.
 */
import { runGoalCompiler } from '../agents/goalCompiler';
import type { CompileResult, ExistingCapability, GoalCompilerInput, GraphSummaryEntry } from '../agents/goalCompiler';
import { guessMaterialRole, runCourseProfile } from '../agents/materials';
import { ancestors } from '../core/graph';
import { centrality } from '../core/leverage';
import { depthSkew, sameRemap } from '../core/goals';
import { EXTRACTED_ROLES } from '../core/types';
import type { Depth, Goal, KnowledgeNode, MaterialRole } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { addCapabilities, addTargets, approvePlannedDepths, deleteCapabilities, getGoal, listCapabilities, listMaterials, listTargets, markCompiled, saveRemap, saveCoverage, saveProfile } from '../store/goals';
import type { NewTarget } from '../store/goals';
import { newId } from '../store/ids';
import { coveredNodeIds, getSource, listChunks } from '../store/sources';
import { getNodes } from '../store/world';
import { addUnverifiedIdeas } from './merger';
import { attributeTime, goalBudgetMinutes, spentByGoal } from './budget';
import { loadKnowledge, refreshGoalFields } from './knowledge';
import type { KnowledgeView } from './knowledge';
import type { GoalDetail } from './goals';
import { goalDetail, recordBaseline } from './goals';

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

  const existing = existingCapabilities(db, goalId, view);
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

/** The goal's capabilities as the compiler sees them: each with its targets at the depth the goal asks. */
export function existingCapabilities(db: Database, goalId: string, view: KnowledgeView = loadKnowledge(db)): ExistingCapability[] {
  const targets = listTargets(db, goalId, { all: true });
  return listCapabilities(db, goalId).map((c) => ({
    id: c.id,
    statement: c.statement,
    mastered: c.masteredAt !== null,
    targets: targets.filter((t) => t.capabilityId === c.id).map((t) => ({ nodeId: t.nodeId, name: view.nodes.get(t.nodeId)?.name ?? t.nodeId, depth: t.idealDepth })),
  }));
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
  addUnverifiedIdeas(db, created);
  // an idea named by a map that waited (a proposal) may be gone since: erased, or retired when its source was read again
  const present = getNodes(db, [...result.capabilities, ...result.extend].flatMap((c) => c.targets.map((t) => tempToId.get(t.ref) ?? t.ref)));
  const resolve = (targets: { ref: string; depth: number; core: boolean }[]) =>
    dedupeTargets(targets.map((t) => ({ nodeId: tempToId.get(t.ref) ?? t.ref, depth: t.depth as Depth, core: t.core })).filter((t) => present.has(t.nodeId)));
  // a new map keeps what the learner asked to add: a capability on an idea they asked for carries
  // their words (and so the weight) over from the capability it replaces
  const askedFor = new Map<string, string>();
  if (options.replace) {
    const old = listCapabilities(db, goalId);
    const requests = new Map(old.flatMap((c) => (c.request ? [[c.id, c.request] as const] : [])));
    for (const t of listTargets(db, goalId, { all: true })) {
      const request = requests.get(t.capabilityId);
      if (request && !askedFor.has(t.nodeId)) askedFor.set(t.nodeId, request);
    }
    deleteCapabilities(db, old.map((c) => c.id));
  }
  deleteCapabilities(db, result.retire);
  for (const e of result.extend) if (!result.retire.includes(e.capabilityId)) addTargets(db, e.capabilityId, resolve(e.targets));
  for (const c of result.capabilities) {
    const targets = resolve(c.targets);
    if (targets.length === 0) continue; // every idea it named is gone
    const request = targets.map((t) => askedFor.get(t.nodeId)).find((r) => r !== undefined) ?? null;
    addCapabilities(db, goalId, [{ statement: c.statement, targets }], request);
  }
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

/** One target per idea: the deepest depth asked, core if any asked it as core. */
export function dedupeTargets(targets: NewTarget[]): NewTarget[] {
  const best = new Map<string, NewTarget>();
  for (const t of targets) {
    const prev = best.get(t.nodeId);
    best.set(t.nodeId, { nodeId: t.nodeId, depth: Math.max(prev?.depth ?? 0, t.depth) as Depth, core: Boolean(prev?.core || t.core) });
  }
  return [...best.values()];
}
