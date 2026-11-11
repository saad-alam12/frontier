/**
 * Re-maps (design §3.2): the probe and sessions note the background the learner showed they lack;
 * when it matters for the time left, the compiler draws the goal's map again as a proposal. The
 * learner sees the new map next to the current one and approves it or keeps theirs; nothing changes
 * on its own.
 */
import { runGoalCompiler } from '../agents/goalCompiler';
import type { RemapRequest } from '../agents/goalCompiler';
import { formatHours } from '../core/budget';
import { remapNeed, sameRemap } from '../core/goals';
import type { RemapNeed } from '../core/goals';
import type { BackgroundGap, Goal, GoalLevel, RemapCause, RemapProposal } from '../core/types';
import type { Database } from '../store/db';
import { dryRun, nowIso, transaction } from '../store/db';
import { approvePlannedDepths, getGoal, saveGaps, saveRemap } from '../store/goals';
import { attributeTime, goalBudgetMinutes, previewPlan, spentByGoal } from './budget';
import type { PlanPreview } from './budget';
import { applyCompile, compileInput } from './goals';
import type { CompileOptions } from './goals';
import { refreshGoalFields } from './knowledge';

const key = (name: string) => name.trim().toLowerCase();

/** Record prerequisites the learner showed they lack; one named before is not counted again. */
export function noteBackgroundGaps(db: Database, goalId: string, gaps: { name: string; hours: number }[], source: BackgroundGap['source']): void {
  const goal = getGoal(db, goalId);
  if (!goal || gaps.length === 0) return;
  const seen = new Set(goal.gaps.map((g) => key(g.name)));
  const added: BackgroundGap[] = [];
  for (const g of gaps) {
    if (!g.name.trim() || seen.has(key(g.name))) continue;
    seen.add(key(g.name));
    added.push({ name: g.name.trim(), hours: g.hours, source, status: 'new', at: nowIso() });
  }
  if (added.length) saveGaps(db, goalId, [...goal.gaps, ...added]);
}

/** Hours left in the goal's time; null without a budget. */
export function hoursLeft(db: Database, goal: Goal): number | null {
  const total = goalBudgetMinutes(db, goal);
  if (total === null) return null;
  return Math.max(0, total - (spentByGoal(attributeTime(db)).get(goal.id) ?? 0)) / 60;
}

/** What the goal's gaps not yet weighed ask of its map. */
export function pendingRemapNeed(db: Database, goal: Goal): RemapNeed {
  return remapNeed(
    goal.gaps.filter((g) => g.status === 'new'),
    hoursLeft(db, goal),
  );
}

/** What the compiler is asked to do for the goal's waiting request, gaps and time left. */
function remapRequestFor(db: Database, goal: Goal): { request: RemapRequest; fresh: BackgroundGap[] } {
  const fresh = goal.gaps.filter((g) => g.status === 'new');
  const causes = goal.remap?.state === 'requested' ? (goal.remap.causes ?? []) : [];
  const need = pendingRemapNeed(db, goal);
  const kind: RemapRequest['kind'] = causes.length ? 'changed' : need === 'none' ? 'asked' : need;
  return { request: { kind, causes, gaps: fresh.map((g) => ({ name: g.name, hours: g.hours })), hoursLeft: hoursLeft(db, goal) }, fresh };
}

/** Draw the goal's map again and store it as a proposal; the gaps it answers are marked proposed. */
export async function proposeRemap(options: CompileOptions, goalId: string): Promise<void> {
  const { db, provider } = options;
  const goal = getGoal(db, goalId);
  if (!goal) return;
  const { request, fresh } = remapRequestFor(db, goal);
  const { input } = compileInput(db, goal);
  const result = await runGoalCompiler(provider, { ...input, remap: request });
  const proposal: RemapProposal = {
    reason: reasonFor(request, fresh, goal.wantedLevel),
    title: result.title,
    level: goal.wantedLevel ?? result.level ?? goal.level ?? 'working',
    scope: result.scope ?? goal.scope ?? '',
    capabilities: result.capabilities,
    newNodes: result.newNodes,
    backgroundGoal: request.kind === 'simplify' ? result.backgroundGoal : null,
    sources: goal.compiledSources,
  };
  const answered = new Set(fresh.map((g) => key(g.name)));
  transaction(db, () => {
    const now = getGoal(db, goalId) ?? goal;
    // the learner changed the goal again while this was drawn: the newer request is drawn next
    if (!sameRemap(now.remap, goal.remap)) return;
    saveGaps(db, goalId, now.gaps.map((g) => (answered.has(key(g.name)) ? { ...g, status: 'proposed' as const } : g)));
    saveRemap(db, goalId, { state: 'ready', at: nowIso(), proposal });
  });
}

/**
 * A draft changed after it was mapped (design §3.2): nothing is approved yet, so it is simply mapped
 * again, with its last map as a guide so ideas that still fit keep their ids.
 */
export async function redrawDraft(options: CompileOptions, goalId: string): Promise<void> {
  const { db, provider } = options;
  const goal = getGoal(db, goalId);
  if (!goal || goal.status !== 'draft' || goal.remap?.state !== 'requested') return;
  const { request } = remapRequestFor(db, goal);
  const { input } = compileInput(db, goal);
  const result = await runGoalCompiler(provider, { ...input, remap: request });
  transaction(db, () => {
    const now = getGoal(db, goalId);
    // approved meanwhile (the request becomes a proposal), or changed again (drawn next)
    if (!now || now.status !== 'draft' || !sameRemap(now.remap, goal.remap)) return;
    applyProposal(db, now, { reason: '', title: result.title, level: now.wantedLevel ?? result.level ?? now.level ?? 'working', scope: result.scope ?? now.scope ?? '', capabilities: result.capabilities, newNodes: result.newNodes, backgroundGoal: null });
    saveRemap(db, goalId, null);
  });
  refreshGoalFields(db);
}

/** "best responses (about 2 hours) and linear algebra (about 10 hours)". */
function gapList(gaps: BackgroundGap[]): string {
  const items = gaps.map((g) => `${g.name} (about ${formatHours(g.hours * 60)})`);
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? '');
}

/** How a chosen depth reads in a sentence: "You chose working knowledge". */
const WANTED_PHRASE: Record<GoalLevel, string> = { intuition: 'the big picture', working: 'working knowledge', rigorous: 'to learn it in full' };

/** Why the learner's edit led to a new map, in their terms. */
function changeReason(causes: RemapCause[], wanted: GoalLevel | null): string {
  const depth = wanted ? `you chose ${WANTED_PHRASE[wanted]}, with no time limit` : 'you gave this goal a time';
  if (causes.includes('context') && causes.includes('level')) return `Your context changed, and ${depth}. The new map follows both.`;
  if (causes.includes('context')) return 'Your context changed. The new map follows it.';
  return wanted ? `You chose ${WANTED_PHRASE[wanted]}, with no time limit. The new map holds what that depth needs.` : 'You gave this goal a time. The new map is sized to it.';
}

function reasonFor(request: RemapRequest, gaps: BackgroundGap[], wanted: GoalLevel | null): string {
  const left = request.hoursLeft;
  if (request.kind === 'changed') return changeReason(request.causes, wanted);
  if (request.kind === 'fill') return `Your answers showed you are missing ${gapList(gaps)}. Your time covers it, so the new map teaches it first.`;
  if (request.kind === 'simplify') {
    return `Your answers showed you are missing ${gapList(gaps)}${left !== null ? `, and this goal has about ${formatHours(left * 60)} left` : ''}. The new map gets you a usable understanding without it.`;
  }
  return 'A fresh map for your time and what you know now.';
}

export interface RemapView {
  reason: string;
  title: string;
  level: GoalLevel;
  scope: string;
  /** The plan as it stands, and the plan the new map would give, for the same time. */
  before: PlanPreview | null;
  after: PlanPreview | null;
  backgroundGoal: { text: string; hours: number } | null;
}

/** The proposal next to the current plan. The new plan is computed by applying the proposal in a savepoint that is rolled back. */
export function remapView(db: Database, goalId: string): RemapView | null {
  const goal = getGoal(db, goalId);
  if (!goal || goal.remap?.state !== 'ready') return null;
  const { proposal } = goal.remap;
  const before = previewPlan(db, goalId, goal.budget);
  const after = dryRun(db, () => {
    applyProposal(db, goal, proposal);
    return previewPlan(db, goalId, goal.budget);
  });
  return { reason: proposal.reason, title: proposal.title, level: proposal.level, scope: proposal.scope, before, after, backgroundGoal: proposal.backgroundGoal };
}

/** The learner chose the new map: it replaces the old one, and its plan is the approved one. */
export function approveRemap(db: Database, goalId: string): void {
  const goal = getGoal(db, goalId);
  if (!goal || goal.remap?.state !== 'ready') return;
  const { proposal } = goal.remap;
  transaction(db, () => {
    applyProposal(db, goal, proposal);
    saveRemap(db, goalId, null);
  });
  refreshGoalFields(db);
  approvePlannedDepths(db, goalId);
}

/** The learner keeps their map. The gaps stay noted and are not proposed again. */
export function dismissRemap(db: Database, goalId: string): void {
  saveRemap(db, goalId, null);
}

function applyProposal(db: Database, goal: Goal, proposal: RemapProposal): void {
  applyCompile(
    db,
    goal,
    { title: proposal.title, level: proposal.level, scope: proposal.scope, coverage: undefined, capabilities: proposal.capabilities, extend: [], retire: [], newNodes: proposal.newNodes },
    // only what the proposal saw: a lecture compiled since it was drawn is compiled again, onto the new map
    proposal.sources ?? goal.compiledSources,
    { replace: true },
  );
}
