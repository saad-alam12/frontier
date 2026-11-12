/**
 * The goal worker: decides what a goal still needs (read its material, profile its exams, compile,
 * work out an addition the learner asked for, propose a re-map) and does it in the background, one
 * run per goal at a time.
 */
import type { Embedder } from '../ingest/embedder';
import type { LlmProvider } from '../llm/provider';
import type { Database } from '../store/db';
import { getGoal, listGoals, listMaterials } from '../store/goals';
import { getSource } from '../store/sources';
import { compileGoal, extractedSources, profileGoal } from './goalCompile';
import type { GoalWorkState } from './goals';
import type { IngestionService } from './ingestion';
import { pendingRemapNeed, proposeRemap, redrawDraft } from './remap';
import { proposeAddition } from './addition';

/** What a goal still needs before it is up to date, in order. Pure decision over stored state. */
export function nextGoalStep(db: Database, goalId: string): 'read' | 'profile' | 'compile' | 'redraw' | 'add' | 'remap' | null {
  const goal = getGoal(db, goalId);
  if (!goal) return null;
  const materials = listMaterials(db, goalId);
  const extracted = extractedSources(db, goalId);
  if (extracted.some((s) => getSource(db, s)?.status !== 'done' && getSource(db, s)?.status !== 'failed')) return 'read';
  const profileSet = materials.filter((m) => m.role === 'assessment' || m.role === 'scope').map((m) => m.sourceId);
  if (!sameSet(profileSet, goal.profileSources)) return 'profile';
  const readable = extracted.filter((s) => getSource(db, s)?.status === 'done');
  // Nothing is being read any more (see above). A goal never mapped is mapped now, also when it has
  // no teaching material to read (only an exam or a syllabus) or its only file could not be read:
  // waiting for material that may never come left the new-goal flow on "Mapping your goal" for good.
  if (goal.compiledAt === null) return 'compile';
  if (readable.some((s) => !goal.compiledSources.includes(s))) return 'compile';
  // a draft changed after it was mapped: nothing is approved yet, so it is mapped again
  if (goal.status === 'draft' && goal.remap?.state === 'requested') return 'redraw';
  // never while a new map is drawn or waits: approving it after the addition would wipe what was added
  const remapOpen = goal.remap?.state === 'requested' || goal.remap?.state === 'ready';
  if (goal.addition?.state === 'requested' && goal.status !== 'draft' && !remapOpen) return 'add';
  // a re-map the learner asked for, or one their missing background calls for (proposed, never
  // applied); not while an addition waits for an answer, so the learner weighs one proposal at a
  // time. An addition still to be worked out waits for the map instead (it is drawn on the new one).
  const adding = goal.addition?.state === 'ready';
  if (goal.status === 'active' && !adding && (goal.remap?.state === 'requested' || (goal.remap === null && pendingRemapNeed(db, goal) !== 'none'))) return 'remap';
  return null;
}

/** What the goal page says while a new map is drawn: for an edit, the edit; otherwise the answers behind it. */
function remapMessage(db: Database, goalId: string): string {
  const remap = getGoal(db, goalId)?.remap;
  if (remap?.state === 'requested' && remap.causes?.length) return 'Drawing a map that follows your changes';
  return remap?.state === 'requested' ? 'Drawing a new map for your time' : 'Drawing a map that fits what your answers showed';
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export interface GoalWorkerDeps {
  db: () => Database;
  provider: () => LlmProvider;
  ingestion: () => IngestionService;
  /** Matches an addition's request to library ideas by meaning. */
  embedder?: () => Embedder;
  onChange: (goalId: string) => void;
}

/**
 * Keeps goals up to date in the background: starts reading new teaching material, then profiles
 * assessment and scope material, then compiles, then proposes a re-map when one is due. One run per
 * goal at a time; a refresh during a run runs again afterwards.
 */
export class GoalWorker {
  private readonly states = new Map<string, GoalWorkState>();
  private readonly running = new Set<string>();
  private readonly again = new Set<string>();

  constructor(private readonly deps: GoalWorkerDeps) {}

  /** True while any goal is being read, profiled or mapped. */
  isBusy(): boolean {
    return this.running.size > 0;
  }

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
    // one run per goal: a compile beside a run in flight wrote the same skills twice
    if (this.running.has(goalId)) {
      this.again.add(goalId);
      return;
    }
    this.running.add(goalId);
    try {
      await this.step(goalId, 'compiling', 'Mapping the skills your goal needs', () => compileGoal({ db: this.deps.db(), provider: this.deps.provider() }, goalId));
    } finally {
      this.running.delete(goalId);
      if (this.again.delete(goalId)) this.refresh(goalId);
    }
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
      const options = { db: this.deps.db(), provider: this.deps.provider() };
      const ok =
        step === 'profile'
          ? await this.step(goalId, 'profiling', "Learning the exam's style from your material", () => profileGoal(options, goalId))
          : step === 'remap'
            ? await this.step(goalId, 'compiling', remapMessage(this.deps.db(), goalId), () => proposeRemap(options, goalId))
            : step === 'redraw'
              ? await this.step(goalId, 'compiling', 'Mapping your goal again for your changes', () => redrawDraft(options, goalId))
              : step === 'add'
                ? await this.step(goalId, 'adding', 'Working out what to add', () => proposeAddition({ ...options, embedder: this.deps.embedder?.(), ingestion: this.deps.ingestion() }, goalId))
                : await this.step(goalId, 'compiling', 'Mapping the skills your goal needs', () => compileGoal(options, goalId));
      if (!ok) return;
    }
  }

  private async step(goalId: string, state: 'profiling' | 'compiling' | 'adding', message: string, fn: () => Promise<unknown>): Promise<boolean> {
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
