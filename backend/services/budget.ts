/**
 * Time budgets over the stores (design §3.4): attributes logged time to goals and resources, plans
 * every goal's remaining time across its ideas (shared ideas paid once), writes each target's planned
 * depth, and reports where a goal stands: time spent against its budget, ideas ready against its plan,
 * and its pace.
 */
import { allocate, budgetMinutes, budgetSpanDays, ideaMinutes, learnerSpeed, paceOf, weeklyMinutes } from '../core/budget';
import type { Allocation, GoalPlan, Pace, PlanGoal, PlanNode, PlanTarget } from '../core/budget';
import { indexChains } from '../core/graph';
import { centrality } from '../core/leverage';
import { EXTRACTED_ROLES, OWNED_DEPTH } from '../core/types';
import type { Depth, Goal, GoalBudget, KnowledgeNode, NodeState } from '../core/types';
import type { Activity } from '../store/activity';
import { listActivity } from '../store/activity';
import type { Database } from '../store/db';
import { listStates } from '../store/evidence';
import { getGoal, listCapabilities, listGoals, listMaterials, listTargets, savePlannedDepths } from '../store/goals';
import { coveredNodeIds, getSource } from '../store/sources';
import { listChains, listNodes } from '../store/world';

const DAY_MS = 86_400_000;
/** Surfaces whose time counts as studying (browsing the map or library does not). */
const STUDY = new Set(['session', 'practice', 'probe']);

/** Teaching resources a per-resource budget counts. */
export function teachingResources(db: Database, goalId: string): string[] {
  return listMaterials(db, goalId)
    .filter((m) => m.role === 'teaching')
    .map((m) => m.sourceId);
}

/** The goal's true total: its time as given (or `budget`, for a preview), plus minutes added by going deeper. */
export function goalBudgetMinutes(db: Database, goal: Goal, budget: GoalBudget | null = goal.budget): number | null {
  const base = budgetMinutes(budget, teachingResources(db, goal.id).length);
  return base === null ? null : base + goal.extraMinutes;
}

interface TimeShare {
  goalId: string;
  minutes: number;
  span: Activity;
}

/**
 * Who each minute of study belongs to. Time on an idea is split evenly between the goals whose plan
 * holds it (shared ideas are not counted twice); time with no idea goes to the activity's goal.
 */
export function attributeTime(db: Database, since?: string): TimeShare[] {
  const goals = new Map(listGoals(db).map((g) => [g.id, g]));
  const caps = new Map(listCapabilities(db).map((c) => [c.id, c.goalId]));
  const goalsOfNode = new Map<string, Set<string>>();
  for (const t of listTargets(db)) {
    const g = caps.get(t.capabilityId);
    if (!g || goals.get(g)?.status !== 'active') continue;
    goalsOfNode.set(t.nodeId, (goalsOfNode.get(t.nodeId) ?? new Set()).add(g));
  }
  const shares: TimeShare[] = [];
  for (const span of listActivity(db, { kinds: ['time'], since })) {
    if (!STUDY.has(String(span.data.surface))) continue;
    const owners = new Set(span.nodeId ? (goalsOfNode.get(span.nodeId) ?? []) : []);
    if (span.goalId && goals.has(span.goalId)) owners.add(span.goalId);
    if (!owners.size) continue;
    for (const goalId of owners) shares.push({ goalId, minutes: span.seconds / 60 / owners.size, span });
  }
  return shares;
}

export function spentByGoal(shares: TimeShare[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of shares) out.set(s.goalId, (out.get(s.goalId) ?? 0) + s.minutes);
  return out;
}

interface PlanInputs {
  goals: Goal[];
  nodes: Map<string, KnowledgeNode>;
  states: Map<string, NodeState>;
  targets: PlanTarget[];
  planNodes: Map<string, PlanNode>;
  spent: Map<string, number>;
  speed: number;
}

/**
 * Everything the allocation needs, for the active goals plus (for a preview) one draft. Each target's
 * ideal depth is capped at the depth the learner approved, so automatic re-plans never go deeper than
 * the approved plan; `uncapped` lifts the caps of one goal, for previewing a new time.
 */
function planInputs(db: Database, options: { include?: string; uncapped?: string } = {}): PlanInputs {
  const goals = listGoals(db).filter((g) => g.status === 'active' || g.id === options.include);
  const goalIds = new Set(goals.map((g) => g.id));
  const caps = new Map(listCapabilities(db).map((c) => [c.id, c.goalId]));
  const nodes = new Map(listNodes(db).map((n) => [n.id, n]));
  const states = listStates(db);
  const index = indexChains(listChains(db));

  // a part the learner keeps adding material on weighs more: 1 + 0.15 per extra source covering an idea
  const coverCount = new Map<string, Map<string, number>>();
  for (const g of goals) {
    const counts = new Map<string, number>();
    for (const m of listMaterials(db, g.id)) {
      if (!EXTRACTED_ROLES.includes(m.role)) continue;
      for (const id of coveredNodeIds(db, m.sourceId)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    coverCount.set(g.id, counts);
  }

  const targets: PlanTarget[] = [];
  for (const t of listTargets(db, undefined, { all: true })) {
    const goalId = caps.get(t.capabilityId);
    if (!goalId || !goalIds.has(goalId) || !nodes.has(t.nodeId)) continue;
    const covered = coverCount.get(goalId)?.get(t.nodeId) ?? 0;
    const cap = goalId === options.uncapped ? null : t.approvedDepth;
    targets.push({
      goalId,
      capabilityId: t.capabilityId,
      nodeId: t.nodeId,
      idealDepth: Math.min(t.idealDepth, cap ?? 5) as Depth,
      weight: Math.min(1.6, 1 + 0.15 * Math.max(0, covered - 1)),
      core: t.core,
    });
  }
  const targeted = new Set(targets.map((t) => t.nodeId));
  const depthOf = (id: string) => states.get(id)?.depth ?? 0;
  const planNodes = new Map<string, PlanNode>();
  for (const id of targeted) {
    const node = nodes.get(id) as KnowledgeNode;
    // premises outside every plan that still have to be owned first, along the cheapest chain in
    const chains = index.into.get(id) ?? [];
    const missing = chains.length ? Math.min(...chains.map((c) => c.premises.filter((p) => !targeted.has(p) && depthOf(p) < OWNED_DEPTH).length)) : 0;
    planNodes.set(id, { id, kind: node.kind, depth: depthOf(id), centrality: centrality(id, index), premiseMinutes: missing * ideaMinutes('claim', 0, OWNED_DEPTH) });
  }

  const shares = attributeTime(db);
  const spent = spentByGoal(shares);
  const learned = goals.reduce((sum, g) => sum + learnedMinutes(g, targets, nodes, states), 0);
  const studied = shares.reduce((sum, s) => sum + s.minutes, 0);
  return { goals, nodes, states, targets, planNodes, spent, speed: learnerSpeed(learned, studied) };
}

/**
 * Minutes the cost model gives for what was learned toward a goal since it started (from its
 * baseline, up to each target's ideal depth), shared ideas split between the goals that hold them.
 */
function learnedMinutes(goal: Goal, targets: PlanTarget[], nodes: Map<string, KnowledgeNode>, states: Map<string, NodeState>): number {
  const holders = new Map<string, Set<string>>();
  for (const t of targets) holders.set(t.nodeId, (holders.get(t.nodeId) ?? new Set()).add(t.goalId));
  const ideal = new Map<string, number>();
  for (const t of targets) if (t.goalId === goal.id) ideal.set(t.nodeId, Math.max(ideal.get(t.nodeId) ?? 0, t.idealDepth));
  let total = 0;
  for (const [nodeId, want] of ideal) {
    const from = goal.baseline[nodeId] ?? 0;
    const to = Math.min(want, states.get(nodeId)?.depth ?? 0);
    if (to > from) total += ideaMinutes(nodes.get(nodeId)?.kind ?? 'claim', from, to) / (holders.get(nodeId)?.size ?? 1);
  }
  return total;
}

function runAllocation(db: Database, inputs: PlanInputs, override?: { goalId: string; budget: GoalBudget | null }): Allocation {
  const planGoals: PlanGoal[] = inputs.goals.map((g) => {
    const budget = override && override.goalId === g.id ? override.budget : g.budget;
    return { id: g.id, budgetMinutes: goalBudgetMinutes(db, g, budget), spentMinutes: inputs.spent.get(g.id) ?? 0, priority: g.priority };
  });
  return allocate(planGoals, inputs.targets, inputs.planNodes, inputs.speed);
}

/**
 * Plan every active goal's remaining time and store each target's planned depth. Called whenever
 * goals, their material or what the learner knows changes (with refreshGoalFields).
 */
export function replan(db: Database): Allocation {
  const inputs = planInputs(db);
  const allocation = runAllocation(db, inputs);
  savePlannedDepths(db, allocation.planned);
  return allocation;
}

/** How fast this learner learns against the cost model (1 until there is enough to go on). */
export function learnerSpeedNow(db: Database): number {
  return planInputs(db).speed;
}

export interface PlanPreview {
  plan: GoalPlan;
  /** Ideas in the preview with the depth the plan gives each (0: left out). */
  ideas: { nodeId: string; name: string; statement: string; kind: KnowledgeNode['kind']; plannedDepth: Depth; idealDepth: Depth; currentDepth: Depth; sharedWith: string[]; skills: string[]; simplified: string | null }[];
  /** True when the plan reaches every target at its full depth with time to spare: a bigger map would use it. */
  roomForMore: boolean;
}

/**
 * What a goal's plan looks like with a given budget, without saving anything: for the preview while
 * the learner sets the time, before approving.
 */
export function previewPlan(db: Database, goalId: string, budget: GoalBudget | null): PlanPreview | null {
  const inputs = planInputs(db, { include: goalId, uncapped: goalId });
  if (!inputs.goals.some((g) => g.id === goalId)) return null;
  const allocation = runAllocation(db, inputs, { goalId, budget });
  const plan = allocation.goals.get(goalId);
  if (!plan) return null;
  const titles = new Map(inputs.goals.map((g) => [g.id, g.title ?? g.text]));
  const skillOf = new Map(listCapabilities(db, goalId).map((c) => [c.id, c.statement]));
  const simplified = new Map<string, string>();
  for (const t of listTargets(db, goalId, { all: true })) if (t.simplified && !simplified.has(t.nodeId)) simplified.set(t.nodeId, t.simplified);
  const byNode = new Map<string, { ideal: number; goals: Set<string>; skills: string[] }>();
  for (const t of inputs.targets) {
    const entry = byNode.get(t.nodeId) ?? { ideal: 0, goals: new Set<string>(), skills: [] };
    const skill = skillOf.get(t.capabilityId);
    if (t.goalId === goalId) entry.ideal = Math.max(entry.ideal, t.idealDepth);
    if (skill && !entry.skills.includes(skill)) entry.skills.push(skill);
    entry.goals.add(t.goalId);
    byNode.set(t.nodeId, entry);
  }
  const ideas = [...byNode.entries()]
    .filter(([, e]) => e.goals.has(goalId))
    .map(([nodeId, e]) => ({
      nodeId,
      name: inputs.nodes.get(nodeId)?.name ?? nodeId,
      statement: inputs.nodes.get(nodeId)?.statement ?? '',
      kind: inputs.nodes.get(nodeId)?.kind ?? 'claim',
      plannedDepth: Math.min(e.ideal, allocation.nodeDepth.get(nodeId) ?? 0) as Depth,
      idealDepth: e.ideal as Depth,
      currentDepth: (inputs.states.get(nodeId)?.depth ?? 0) as Depth,
      sharedWith: [...e.goals].filter((g) => g !== goalId).map((g) => titles.get(g) ?? g),
      skills: e.skills,
      simplified: simplified.get(nodeId) ?? null,
    }))
    .sort((a, b) => b.plannedDepth - a.plannedDepth || b.idealDepth - a.idealDepth || a.name.localeCompare(b.name));
  const total = plan.budgetMinutes;
  const roomForMore = total !== null && plan.ideas.trimmed === 0 && plan.plannedMinutes + plan.spentMinutes < total * 0.6;
  return { plan, ideas, roomForMore };
}

export interface ResourceTime {
  sourceId: string;
  title: string;
  minutes: number;
  /** The per-resource budget, when the goal has one. */
  targetMinutes: number | null;
}

export interface GoalProgress {
  budget: GoalBudget | null;
  /** No time limit: the plan holds every idea at its full depth and its minutes are an estimate, not a budget. */
  noLimit: boolean;
  /** The true total in minutes. */
  totalMinutes: number | null;
  spentMinutes: number;
  /** Minutes this week (since Monday). */
  weekMinutes: number;
  /** What the budget's rhythm asks per week; null for totals without a date. */
  weeklyTarget: number | null;
  /** Minutes the rhythm expected by now; null without a rhythm. */
  expectedByNow: number | null;
  /** End of a rate budget or the goal's date. */
  endsOn: string | null;
  plan: GoalPlan;
  pace: Pace;
  resources: ResourceTime[];
  /** Minutes the learner learns in, against the plan's estimate (1 = as planned). */
  speed: number;
}

/** Where a goal stands against its budget and plan. */
export function goalProgress(db: Database, goalId: string, now = new Date()): GoalProgress | null {
  const goal = getGoal(db, goalId);
  if (!goal) return null;
  const inputs = planInputs(db, { include: goalId });
  const allocation = runAllocation(db, inputs);
  const plan = allocation.goals.get(goalId);
  if (!plan) return null;
  const shares = attributeTime(db).filter((s) => s.goalId === goalId);
  const spentMinutes = shares.reduce((s, x) => s + x.minutes, 0);
  const monday = startOfWeek(now).toISOString();
  const weekMinutes = shares.filter((s) => s.span.endedAt >= monday).reduce((s, x) => s + x.minutes, 0);
  const total = goalBudgetMinutes(db, goal);
  const start = goal.approvedAt ?? goal.createdAt;
  const weeklyTarget = weeklyMinutes(goal.budget, total, start, goal.date);
  const daysIn = Math.max(0, (now.getTime() - new Date(start).getTime()) / DAY_MS);
  const expectedByNow = weeklyTarget !== null ? Math.min(total ?? Infinity, (weeklyTarget * daysIn) / 7) : null;
  const span = budgetSpanDays(goal.budget);
  const endsOn = span !== null ? new Date(new Date(start).getTime() + span * DAY_MS).toISOString().slice(0, 10) : goal.date;
  const pace = paceOf({ budgetMinutes: total, spentMinutes, learnedMinutes: learnedMinutes(goal, inputs.targets, inputs.nodes, inputs.states), expectedByNow, daysIn });

  // per resource: time on an idea is split between the goal's sources that cover it
  const teaching = listMaterials(db, goalId).filter((m) => EXTRACTED_ROLES.includes(m.role));
  const coverers = new Map<string, string[]>();
  for (const m of teaching) for (const id of coveredNodeIds(db, m.sourceId)) coverers.set(id, [...(coverers.get(id) ?? []), m.sourceId]);
  const perSource = new Map<string, number>();
  for (const s of shares) {
    const sources = s.span.nodeId ? (coverers.get(s.span.nodeId) ?? []) : [];
    for (const src of sources) perSource.set(src, (perSource.get(src) ?? 0) + s.minutes / sources.length);
  }
  const perResource = goal.budget?.mode === 'resource' ? goal.budget.hours * 60 : null;
  const resources = teaching
    .filter((m) => m.role === 'teaching' || perSource.has(m.sourceId))
    .map((m) => ({ sourceId: m.sourceId, title: getSource(db, m.sourceId)?.title ?? m.sourceId, minutes: Math.round(perSource.get(m.sourceId) ?? 0), targetMinutes: m.role === 'teaching' ? perResource : null }));

  return {
    budget: goal.budget,
    noLimit: goal.wantedLevel !== null,
    totalMinutes: total,
    spentMinutes: Math.round(spentMinutes),
    weekMinutes: Math.round(weekMinutes),
    weeklyTarget,
    expectedByNow: expectedByNow === null ? null : Math.round(expectedByNow),
    endsOn,
    plan,
    pace,
    resources,
    speed: inputs.speed,
  };
}

function startOfWeek(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
