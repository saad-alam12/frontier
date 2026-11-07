/**
 * Adding to a goal (design §3.2): the learner says in their words what else they want to learn here.
 * The goal worker runs the compiler's addition mode in the background; the learner then sees what
 * joins and what it does to the plan (a fixed time makes room; no time limit grows the estimate) and
 * adds it or not. Nothing changes until they say yes.
 */
import { runGoalAddition } from '../agents/goalAddition';
import type { AdditionInput } from '../agents/goalAddition';
import type { GraphSummaryEntry } from '../agents/goalCompiler';
import { planDiff } from '../core/planDiff';
import { ADDITION_MAX_CHARS } from '../core/types';
import type { AdditionProposal, Depth, Goal, GoalAddition, KnowledgeNode } from '../core/types';
import type { Embedder } from '../ingest/embedder';
import type { LlmProvider } from '../llm/provider';
import { logEvent } from '../store/activity';
import type { Database } from '../store/db';
import { dryRun, nowIso, transaction } from '../store/db';
import { addCapabilities, approvePlannedDepths, getGoal, listTargets, saveAddition, startUnverified } from '../store/goals';
import { newId } from '../store/ids';
import { createUnverifiedNodes, getNodes } from '../store/world';
import { goalBudgetMinutes, previewPlan } from './budget';
import type { PlanPreview } from './budget';
import { dedupeTargets, existingCapabilities, recordBaseline } from './goals';
import type { IngestionService } from './ingestion';
import { loadKnowledge, refreshGoalFields } from './knowledge';
import { searchIdeas } from './lookup';

/** Library ideas matching the request that the compiler sees, so it targets them instead of re-creating them. */
const LIBRARY_MATCHES = 25;

/**
 * The learner asked to add something: it is worked out in the background (the goal worker picks it
 * up). A request made while another is open replaces it.
 */
export function requestAddition(db: Database, goalId: string, request: string): void {
  const text = request.trim();
  if (!text) throw new Error('Say what you want to add.');
  if (text.length > ADDITION_MAX_CHARS) throw new Error(`Keep it to ${ADDITION_MAX_CHARS} characters or fewer.`);
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error('unknown goal');
  if (goal.status === 'draft' || goal.compiledAt === null) throw new Error('You can add to a goal once its plan is ready.');
  // one proposal at a time: the addition would be drawn on a map the learner may be about to replace
  if (goal.remap?.state === 'ready') throw new Error('Choose between your map and the new one first.');
  saveAddition(db, goalId, { state: 'requested', request: text, at: nowIso() });
}

export interface AdditionDeps {
  db: Database;
  provider: LlmProvider;
  /** For matching the request to library ideas by meaning; name matching works without it. */
  embedder?: Embedder;
  ingestion?: IngestionService;
}

/** What the compiler sees: the goal, its map, its ideas and the library's ideas that match the request. */
export function additionInput(db: Database, goal: Goal, request: string, matches: string[]): AdditionInput {
  const view = loadKnowledge(db);
  const own = new Set(listTargets(db, goal.id, { all: true }).map((t) => t.nodeId));
  const held = new Set(listTargets(db).map((t) => t.nodeId));
  const entry = (n: KnowledgeNode): GraphSummaryEntry => ({
    id: n.id,
    kind: n.kind,
    name: n.name,
    statement: n.statement,
    inMaterial: own.has(n.id),
    elsewhere: own.has(n.id) ? undefined : view.owned.has(n.id) ? 'known' : held.has(n.id) ? 'other goal' : undefined,
  });
  const ids = [...own, ...matches.filter((id) => !own.has(id))];
  const graph = ids.map((id) => view.nodes.get(id)).filter((n): n is KnowledgeNode => n !== undefined).map(entry);
  const total = goalBudgetMinutes(db, goal);
  return {
    request,
    goal: {
      text: goal.text,
      title: goal.title,
      assessment: goal.assessment,
      focus: goal.focus,
      context: goal.context,
      level: goal.level,
      scope: goal.scope,
      budgetHours: total === null ? null : total / 60,
      wantedLevel: goal.wantedLevel,
    },
    existing: existingCapabilities(db, goal.id, view),
    graph,
  };
}

/**
 * Work out the waiting request and keep the result as a proposal (or the failure, so the goal page can
 * say so and offer to try again). A request changed or withdrawn meanwhile is left alone.
 */
export async function proposeAddition(deps: AdditionDeps, goalId: string): Promise<void> {
  const { db } = deps;
  const goal = getGoal(db, goalId);
  const asked = goal?.addition;
  if (!goal || asked?.state !== 'requested') return;
  let next: GoalAddition;
  try {
    const hits = await searchIdeas({ db, embedder: deps.embedder, ingestion: deps.ingestion }, asked.request, LIBRARY_MATCHES);
    const proposal = await runGoalAddition(
      deps.provider,
      additionInput(
        db,
        goal,
        asked.request,
        hits.map((h) => h.nodeId),
      ),
    );
    next = { state: 'ready', request: asked.request, at: asked.at, proposal };
  } catch (error) {
    next = { state: 'failed', request: asked.request, at: asked.at, message: error instanceof Error ? error.message : String(error) };
  }
  transaction(db, () => {
    if (JSON.stringify(getGoal(db, goalId)?.addition ?? null) === JSON.stringify(asked)) saveAddition(db, goalId, next);
  });
}

/**
 * Write an addition: its new ideas (unverified, as a compile creates them) and its capabilities, which
 * keep the learner's words. Ideas erased since the proposal are skipped. Returns the ideas it targets.
 */
function writeAddition(db: Database, goal: Goal, proposal: AdditionProposal, request: string): string[] {
  const tempToId = new Map<string, string>();
  const created = proposal.newNodes.map((n) => {
    const id = newId('node');
    tempToId.set(n.tempId, id);
    return { id, kind: n.kind, name: n.name, statement: n.statement, aliases: [] };
  });
  if (created.length) createUnverifiedNodes(db, created);
  const refs = proposal.capabilities.flatMap((c) => c.targets.map((t) => tempToId.get(t.ref) ?? t.ref));
  const present = getNodes(db, refs);
  const capabilities = proposal.capabilities
    .map((c) => ({ statement: c.statement, targets: dedupeTargets(c.targets.map((t) => ({ nodeId: tempToId.get(t.ref) ?? t.ref, depth: t.depth as Depth, core: t.core })).filter((t) => present.has(t.nodeId))) }))
    .filter((c) => c.targets.length > 0);
  addCapabilities(db, goal.id, capabilities, request);
  return [...new Set(capabilities.flatMap((c) => c.targets.map((t) => t.nodeId)))];
}

export interface AdditionView {
  request: string;
  fits: boolean;
  /** Why it is a goal of its own, when it does not fit. */
  reason: string | null;
  shape: AdditionProposal['shape'];
  /** The skills it adds. */
  skills: string[];
  /** The ideas it brings, as the plan would hold them. */
  ideas: PlanPreview['ideas'];
  /** How many ideas the plan holds that it did not before, and how many it already held that go deeper. */
  joined: number;
  deeper: number;
  /** The goal's fixed time in minutes; null with no time limit (the estimate grows instead). */
  totalMinutes: number | null;
  /** How much the plan's time grows: with no time limit, the estimate; with a fixed time, close to nothing. */
  addedMinutes: number;
  /** Names of the goal's other ideas that make room, and of new ideas the time cannot hold. */
  changes: { overview: string[]; leftOut: string[]; shallower: string[]; missed: string[] };
}

/**
 * The proposal next to the plan as it is: the addition is written inside a savepoint that is always
 * rolled back, so the preview runs the same plan code as the real thing.
 */
export function additionView(db: Database, goalId: string): AdditionView | null {
  const goal = getGoal(db, goalId);
  if (!goal || goal.addition?.state !== 'ready') return null;
  const { proposal, request } = goal.addition;
  const before = previewPlan(db, goalId, goal.budget, { keepCaps: true });
  const result = dryRun(db, () => {
    const targeted = writeAddition(db, goal, proposal, request);
    return { targeted, after: previewPlan(db, goalId, goal.budget, { keepCaps: true }) };
  });
  if (!before || !result.after) return null;
  const { after, targeted } = result;
  const diff = planDiff(before.ideas, after.ideas);
  const nameOf = new Map(after.ideas.map((i) => [i.nodeId, i.name]));
  const names = (ids: string[]) => ids.map((id) => nameOf.get(id) ?? id);
  const added = new Set(targeted);
  const was = new Map(before.ideas.map((i) => [i.nodeId, i.plannedDepth]));
  return {
    request,
    fits: proposal.fits,
    reason: proposal.reason,
    shape: proposal.shape,
    skills: proposal.capabilities.map((c) => c.statement),
    ideas: after.ideas.filter((i) => added.has(i.nodeId)),
    joined: diff.joined.length,
    deeper: after.ideas.filter((i) => added.has(i.nodeId) && (was.get(i.nodeId) ?? 0) > 0 && i.plannedDepth > (was.get(i.nodeId) ?? 0)).length,
    totalMinutes: after.plan.budgetMinutes,
    addedMinutes: Math.max(0, after.plan.plannedMinutes - before.plan.plannedMinutes),
    changes: { overview: names(diff.overview), leftOut: names(diff.leftOut), shallower: names(diff.shallower), missed: names(diff.missed) },
  };
}

/**
 * The learner said yes: the new capabilities join the goal with the learner's words; existing
 * capabilities and their approved depths stay. The new ideas are taught from the model's knowledge at
 * once (started, as a goal from scratch is), and the new targets join the approved plan at the depth
 * the plan gives them.
 */
export function applyAddition(db: Database, goalId: string): void {
  const goal = getGoal(db, goalId);
  if (!goal || goal.addition?.state !== 'ready') return;
  const { proposal, request } = goal.addition;
  transaction(db, () => {
    const targeted = writeAddition(db, goal, proposal, request);
    const nodes = getNodes(db, targeted);
    for (const id of targeted) if (nodes.get(id)?.status === 'unverified') startUnverified(db, goalId, id);
    saveAddition(db, goalId, null);
    recordBaseline(db, goalId);
    logEvent(db, 'goal.extended', { goalId }, { request, fits: proposal.fits, skills: proposal.capabilities.length, ideas: targeted.length });
  });
  refreshGoalFields(db);
  approvePlannedDepths(db, goalId);
}

/** The learner does not add it (or makes it a goal of its own); a failed or waiting request goes too. */
export function dismissAddition(db: Database, goalId: string): void {
  saveAddition(db, goalId, null);
}
