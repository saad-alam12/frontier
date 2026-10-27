/**
 * Goals (design §3): a goal with its kind, assessment and material; an incremental compile into
 * capabilities and targets scoped to the goal's own material; the exam profile and course plan; and a
 * small worker that reads new material, profiles it and recompiles when material arrives.
 */
import { runGoalCompiler } from '../agents/goalCompiler';
import type { ExistingCapability, GraphSummaryEntry } from '../agents/goalCompiler';
import { guessMaterialRole, runCourseProfile } from '../agents/materials';
import { ancestors } from '../core/graph';
import { depthSkew, skillStatus } from '../core/goals';
import type { SkillStatus } from '../core/goals';
import { EXTRACTED_ROLES } from '../core/types';
import type { Capability, Depth, Goal, KnowledgeNode, MaterialRole, Source, Target } from '../core/types';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { transaction } from '../store/db';
import { getState } from '../store/evidence';
import type { GoalInput } from '../store/goals';
import { addCapabilities, addTargets, createGoal, deleteCapabilities, getGoal, listCapabilities, listGoals, listMaterials, listTargets, markCompiled, saveProfile, setMaterials, updateGoal } from '../store/goals';
import { newId } from '../store/ids';
import { coveredNodeIds, getSource, listChunks } from '../store/sources';
import { createUnverifiedNodes, getNodes } from '../store/world';
import type { IngestionService } from './ingestion';
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
    targets: (Target & { name: string; kind: KnowledgeNode['kind']; status: KnowledgeNode['status']; currentDepth: Depth })[];
  })[];
  /** Targets no source covers yet ("expected, not in your material"). */
  expected: { nodeId: string; name: string; statement: string; started: boolean }[];
  materials: MaterialView[];
  /** The next ideas a session would start from, for "This week". */
  nextIdeas: string[];
  /** What the scheduler suggests today; null until the goal is compiled. */
  schedule: GoalSchedule | null;
  work: GoalWorkState;
}

export function goalDetail(db: Database, goalId: string, work: GoalWorkState = { state: 'idle' }): GoalDetail | undefined {
  const goal = getGoal(db, goalId);
  if (!goal) return undefined;
  const view = loadKnowledge(db);
  const targets = listTargets(db, goalId);
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
    return { ...cap, status: skillStatus(cap.masteredAt, capTargets), targets: capTargets };
  });
  const expectedIds = [...new Set(targets.map((t) => t.nodeId))].filter((id) => nodes.get(id)?.status === 'unverified');
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
    schedule: capabilities.length ? goalSchedule(db, goalId) : null,
    work,
  };
}

export function createGoalFromForm(db: Database, form: GoalForm): Goal {
  return transaction(db, () => {
    const goal = createGoal(db, form);
    setMaterials(db, goal.id, form.materials);
    return goal;
  });
}

export function updateGoalFromForm(db: Database, goalId: string, form: Partial<GoalForm>): void {
  transaction(db, () => {
    const { materials, ...fields } = form;
    updateGoal(db, goalId, fields);
    if (materials) setMaterials(db, goalId, materials);
  });
  refreshGoalFields(db);
}

/** Sources whose text is read into ideas for this goal (teaching and reference material). */
function extractedSources(db: Database, goalId: string): string[] {
  return listMaterials(db, goalId)
    .filter((m) => EXTRACTED_ROLES.includes(m.role))
    .map((m) => m.sourceId);
}

export interface CompileOptions {
  db: Database;
  provider: LlmProvider;
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
  const materials = listMaterials(db, goalId);
  const sources = extractedSources(db, goalId);
  const view = loadKnowledge(db);

  const inMaterial = new Set(sources.flatMap((s) => coveredNodeIds(db, s)).filter((id) => view.nodes.has(id)));
  const existingTargets = listTargets(db, goalId);
  const scope = new Set(inMaterial);
  for (const id of inMaterial) for (const a of ancestors(id, view.index)) scope.add(a);
  for (const t of existingTargets) scope.add(t.nodeId);
  const graph: GraphSummaryEntry[] = [...scope]
    .map((id) => view.nodes.get(id))
    .filter((n): n is KnowledgeNode => n !== undefined)
    .map((n) => ({ id: n.id, kind: n.kind, name: n.name, statement: n.statement, inMaterial: inMaterial.has(n.id) }));

  const existing: ExistingCapability[] = listCapabilities(db, goalId).map((c) => ({
    id: c.id,
    statement: c.statement,
    mastered: c.masteredAt !== null,
    targets: existingTargets.filter((t) => t.capabilityId === c.id).map((t) => ({ nodeId: t.nodeId, name: view.nodes.get(t.nodeId)?.name ?? t.nodeId, depth: t.depth })),
  }));
  const newMaterial = sources.filter((s) => !goal.compiledSources.includes(s)).map((s) => getSource(db, s)?.title ?? s);

  const result = await runGoalCompiler(provider, {
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
  });

  transaction(db, () => {
    const tempToId = new Map<string, string>();
    const created = result.newNodes.map((n) => {
      const id = newId('node');
      tempToId.set(n.tempId, id);
      return { id, kind: n.kind, name: n.name, statement: n.statement, aliases: [] };
    });
    if (created.length) createUnverifiedNodes(db, created);
    const resolve = (targets: { ref: string; depth: number }[]) => dedupeTargets(targets.map((t) => ({ nodeId: tempToId.get(t.ref) ?? t.ref, depth: t.depth as Depth })));
    deleteCapabilities(db, result.retire);
    for (const e of result.extend) if (!result.retire.includes(e.capabilityId)) addTargets(db, e.capabilityId, resolve(e.targets));
    addCapabilities(
      db,
      goalId,
      result.capabilities.map((c) => ({ statement: c.statement, targets: resolve(c.targets) })),
    );
    markCompiled(db, goalId, result.title, sources.filter((s) => getSource(db, s)?.status === 'done' || goal.compiledSources.includes(s)));
  });

  const skew = depthSkew(listTargets(db, goalId).map((t) => t.depth));
  if (skew.overTargeted) console.warn(`goal ${goalId}: ${Math.round(skew.deepShare * 100)}% of targets are at depth 3 or more; the compiler is over-targeting`);
  refreshGoalFields(db);
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

function dedupeTargets(targets: { nodeId: string; depth: Depth }[]): { nodeId: string; depth: Depth }[] {
  const best = new Map<string, Depth>();
  for (const t of targets) if ((best.get(t.nodeId) ?? 0) < t.depth) best.set(t.nodeId, t.depth);
  return [...best.entries()].map(([nodeId, depth]) => ({ nodeId, depth }));
}

/** What a goal still needs before it is up to date, in order. Pure decision over stored state. */
export function nextGoalStep(db: Database, goalId: string): 'read' | 'profile' | 'compile' | null {
  const goal = getGoal(db, goalId);
  if (!goal) return null;
  const materials = listMaterials(db, goalId);
  const extracted = extractedSources(db, goalId);
  if (extracted.some((s) => getSource(db, s)?.status !== 'done' && getSource(db, s)?.status !== 'failed')) return 'read';
  const profileSet = materials.filter((m) => m.role === 'assessment' || m.role === 'scope').map((m) => m.sourceId);
  if (!sameSet(profileSet, goal.profileSources)) return 'profile';
  const readable = extracted.filter((s) => getSource(db, s)?.status === 'done');
  if (goal.compiledAt === null) return materials.length === 0 || readable.length > 0 ? 'compile' : null;
  return readable.some((s) => !goal.compiledSources.includes(s)) ? 'compile' : null;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export interface GoalWorkerDeps {
  db: () => Database;
  provider: () => LlmProvider;
  ingestion: () => IngestionService;
  onChange: (goalId: string) => void;
}

/**
 * Keeps goals up to date in the background: starts reading new teaching material, then profiles
 * assessment and scope material, then compiles. One run per goal at a time; a refresh during a run
 * runs again afterwards.
 */
export class GoalWorker {
  private readonly states = new Map<string, GoalWorkState>();
  private readonly running = new Set<string>();
  private readonly again = new Set<string>();

  constructor(private readonly deps: GoalWorkerDeps) {}

  status(goalId: string): GoalWorkState {
    return this.states.get(goalId) ?? { state: 'idle' };
  }

  /** Called when a source finishes ingesting: every goal using it may be ready for the next step. */
  onSourceDone(sourceId: string): void {
    for (const goal of listGoals(this.deps.db())) if (listMaterials(this.deps.db(), goal.id).some((m) => m.sourceId === sourceId)) this.refresh(goal.id);
  }

  refresh(goalId: string): void {
    if (this.running.has(goalId)) {
      this.again.add(goalId);
      return;
    }
    this.running.add(goalId);
    void this.run(goalId).finally(() => {
      this.running.delete(goalId);
      if (this.again.delete(goalId)) this.refresh(goalId);
    });
  }

  /** Recompile now even if nothing new arrived (the learner asked). */
  async compileNow(goalId: string): Promise<void> {
    await this.step(goalId, 'compiling', 'Mapping the skills your goal needs', () => compileGoal({ db: this.deps.db(), provider: this.deps.provider() }, goalId));
  }

  private async run(goalId: string): Promise<void> {
    for (let guard = 0; guard < 4; guard += 1) {
      const step = nextGoalStep(this.deps.db(), goalId);
      if (step === null) return this.set(goalId, { state: 'idle' });
      if (step === 'read') {
        const pending = extractedSources(this.deps.db(), goalId).filter((s) => getSource(this.deps.db(), s)?.status !== 'done');
        for (const s of pending) this.deps.ingestion().start(s);
        return this.set(goalId, { state: 'reading', message: 'Reading your material' });
      }
      const ok =
        step === 'profile'
          ? await this.step(goalId, 'profiling', "Learning the exam's style from your material", () => profileGoal({ db: this.deps.db(), provider: this.deps.provider() }, goalId))
          : await this.step(goalId, 'compiling', 'Mapping the skills your goal needs', () => compileGoal({ db: this.deps.db(), provider: this.deps.provider() }, goalId));
      if (!ok) return;
    }
  }

  private async step(goalId: string, state: 'profiling' | 'compiling', message: string, fn: () => Promise<unknown>): Promise<boolean> {
    this.set(goalId, { state, message });
    try {
      await fn();
      this.set(goalId, { state: 'idle' });
      return true;
    } catch (error) {
      this.set(goalId, { state: 'failed', message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  private set(goalId: string, state: GoalWorkState): void {
    this.states.set(goalId, state);
    this.deps.onChange(goalId);
  }
}
