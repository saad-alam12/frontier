/**
 * Time budgets over the stores (design §3.4): attributes logged time to goals and resources, plans
 * every goal's remaining time across its ideas (shared ideas paid once), writes each target's planned
 * depth, and reports where a goal stands: time spent against its budget, ideas ready against its plan,
 * and its pace.
 */
import { SESSION_MINUTES, allocate, budgetMinutes, budgetSpanDays, ideaMinutes, learnerSpeed, paceOf, weeklyMinutes } from '../core/budget';
import type { Allocation, GoalPlan, Pace, PlanGoal, PlanNode, PlanTarget } from '../core/budget';
import { addDays, localDate } from '../core/dates';
import { roadmap } from '../core/plan';
import { indexChains } from '../core/graph';
import { EXTRACTED_ROLES, OWNED_DEPTH } from '../core/types';
import type { Capability, Depth, Goal, GoalBudget, KnowledgeNode, NodeState, Target } from '../core/types';
import type { Activity } from '../store/activity';
import { listActivity, setSpanOwners } from '../store/activity';
import type { Database } from '../store/db';
import { listStates } from '../store/evidence';
import { getGoal, listCapabilities, listGoals, listMaterials, listTargets, savePlannedDepths } from '../store/goals';
import { coveredNodeIds, getSource } from '../store/sources';
import { listChains, listNodes } from '../store/world';
import { cachedRead } from '../store/readCache';
import { worldGraph } from './worldGraph';

const DAY_MS = 86_400_000;
/** Surfaces whose time counts as studying (browsing the map or library does not); flashcard reviews count for the card's goal. */
const STUDY = new Set(['session', 'practice', 'probe', 'cards']);

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
 * The goals a minute of study on this idea (or just for this goal) belongs to right now: the active
 * goals whose plan holds the idea, and the goal the learner was working for. Asked when the time is
 * logged and stored with it.
 */
export function timeOwners(db: Database, context: { goalId?: string | null; nodeId?: string | null }): string[] {
  const goals = new Map(listGoals(db).map((g) => [g.id, g]));
  const owners = new Set<string>();
  if (context.nodeId) {
    const caps = new Map(listCapabilities(db).map((c) => [c.id, c.goalId]));
    for (const t of listTargets(db)) {
      const g = caps.get(t.capabilityId);
      if (t.nodeId === context.nodeId && g && goals.get(g)?.status === 'active') owners.add(g);
    }
  }
  if (context.goalId && goals.has(context.goalId)) owners.add(context.goalId);
  return [...owners];
}

/**
 * Who each minute of study belongs to. Time on an idea is split evenly between the goals whose plan
 * held it when it was studied (shared ideas are not counted twice); time with no idea goes to the
 * activity's goal. The owners are the ones stored with the time: a goal added, paused, finished or
 * removed later does not move minutes that were already spent. A share can therefore name a goal
 * that no longer exists.
 */
export function attributeTime(db: Database, since?: string): TimeShare[] {
  // the whole history is read by most screens; it is kept until something is written
  if (since === undefined) return cachedRead(db, 'time.shares', () => sharesOf(db));
  return sharesOf(db, since);
}

function sharesOf(db: Database, since?: string): TimeShare[] {
  const shares: TimeShare[] = [];
  for (const span of listActivity(db, { kinds: ['time'], since })) {
    if (!STUDY.has(String(span.data.surface))) continue;
    const stored = span.data.owners;
    const owners = Array.isArray(stored) ? (stored as string[]) : timeOwners(db, span);
    if (!owners.length) continue;
    for (const goalId of owners) shares.push({ goalId, minutes: span.seconds / 60 / owners.length, span });
  }
  return shares;
}

/** Time logged before owners were stored gets them once, by today's goals, so it stops moving from then on. */
export function freezeTimeOwners(db: Database): number {
  let frozen = 0;
  for (const span of listActivity(db, { kinds: ['time'] })) {
    if (!STUDY.has(String(span.data.surface)) || Array.isArray(span.data.owners)) continue;
    setSpanOwners(db, span.id, timeOwners(db, span));
    frozen += 1;
  }
  return frozen;
}

/**
 * How fast this learner learns against the cost model: time spent learning new ideas, over the
 * model's minutes for what was learned (1 means as estimated; see `learnerSpeed` for the limits).
 * Both sides cover the same goals, every goal that is not a draft, so pausing or finishing a goal
 * leaves the number where it was. Only session time counts: practice and flashcards keep what is
 * known and would make a steady learner look slower with every month of upkeep. What a goal's
 * baseline holds (what the learner knew when it started, or showed in its probe) was not learned
 * in that time and does not count.
 */
export function learnerSpeedNow(db: Database): number {
  return cachedRead(db, 'learner.speed', () => speedNow(db));
}

function speedNow(db: Database): number {
  const goals = listGoals(db).filter((g) => g.status !== 'draft');
  const goalIds = new Set(goals.map((g) => g.id));
  const goalOf = new Map(listCapabilities(db).map((c) => [c.id, c.goalId]));
  const nodes = new Map(listNodes(db).map((n) => [n.id, n]));
  const states = listStates(db);
  const targets: Pick<PlanTarget, 'goalId' | 'nodeId' | 'idealDepth'>[] = [];
  for (const t of listTargets(db, undefined, { all: true })) {
    const goalId = goalOf.get(t.capabilityId);
    if (goalId && goalIds.has(goalId) && nodes.has(t.nodeId)) targets.push({ goalId, nodeId: t.nodeId, idealDepth: t.idealDepth });
  }
  const targeted = new Set(targets.map((t) => t.nodeId));
  const learned = goals.reduce((sum, g) => sum + learnedMinutes(g, targets, nodes, states), 0);
  const inSessions = attributeTime(db).filter((s) => s.span.data.surface === 'session' && goalIds.has(s.goalId));
  // depth gained on a goal's ideas in free study counts as learned, so the time it took counts as
  // studied too (it is still no goal's time); otherwise free study would make the learner look faster
  const freeOnGoalIdeas = freeStudy(db).filter((f) => f.span.nodeId !== null && targeted.has(f.span.nodeId));
  const studied = inSessions.reduce((sum, s) => sum + s.minutes, 0) + freeOnGoalIdeas.reduce((sum, f) => sum + f.minutes, 0);
  return learnerSpeed(learned, studied);
}

/** Free study (design §4.5): time in chosen sessions booked to no goal, which no goal's budget counts. */
export function freeStudy(db: Database, since?: string): { minutes: number; span: Activity }[] {
  return listActivity(db, { kinds: ['time'], since })
    .filter((span) => span.data.surface === 'free')
    .map((span) => ({ minutes: span.seconds / 60, span }));
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

/** What every plan reads, whatever goal it is for: kept until the database changes. */
interface PlanBase {
  goals: Goal[];
  capabilities: Map<string, Capability>;
  nodes: Map<string, KnowledgeNode>;
  states: Map<string, NodeState>;
  targets: Target[];
  /** Per goal: how many of its extracted sources cover each idea. */
  coverCount: Map<string, Map<string, number>>;
  spent: Map<string, number>;
  speed: number;
}

function planBase(db: Database): PlanBase {
  return cachedRead(db, 'plan.base', () => {
    const goals = listGoals(db);
    const coverCount = new Map<string, Map<string, number>>();
    for (const g of goals) {
      const counts = new Map<string, number>();
      for (const m of listMaterials(db, g.id)) {
        if (!EXTRACTED_ROLES.includes(m.role)) continue;
        for (const id of coveredNodeIds(db, m.sourceId)) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      coverCount.set(g.id, counts);
    }
    return {
      goals,
      capabilities: new Map(listCapabilities(db).map((c) => [c.id, c])),
      nodes: new Map(listNodes(db).map((n) => [n.id, n])),
      states: listStates(db),
      targets: listTargets(db, undefined, { all: true }),
      coverCount,
      spent: spentByGoal(attributeTime(db)),
      speed: learnerSpeedNow(db),
    };
  });
}

/**
 * Everything the allocation needs, for the active goals plus (for a preview) one draft. Each target's
 * ideal depth is capped at the depth the learner approved, so automatic re-plans never go deeper than
 * the approved plan; `uncapped` lifts the caps of one goal, for previewing a new time. Kept until the
 * database changes, as a goal page and Today ask for the same inputs several times.
 */
function planInputs(db: Database, options: { include?: string; uncapped?: string } = {}): PlanInputs {
  const base = planBase(db);
  // including a goal that is active anyway changes nothing
  const include = options.include && base.goals.find((g) => g.id === options.include)?.status !== 'active' ? options.include : '';
  return cachedRead(db, `plan.inputs:${include}:${options.uncapped ?? ''}`, () => buildPlanInputs(db, base, include, options.uncapped));
}

function buildPlanInputs(db: Database, base: PlanBase, include: string, uncapped: string | undefined): PlanInputs {
  const { capabilities, nodes, states } = base;
  const goals = base.goals.filter((g) => g.status === 'active' || g.id === include);
  const goalIds = new Set(goals.map((g) => g.id));
  const graph = worldGraph(db);

  // a part the learner keeps adding material on weighs more: 1 + 0.15 per extra source covering an idea
  const targets: PlanTarget[] = [];
  for (const t of base.targets) {
    const capability = capabilities.get(t.capabilityId);
    const goalId = capability?.goalId;
    if (!goalId || !goalIds.has(goalId) || !nodes.has(t.nodeId)) continue;
    const covered = base.coverCount.get(goalId)?.get(t.nodeId) ?? 0;
    // previewing a new time lifts what the old time trimmed, but an idea that was simplified stays as it
    // was learned until the learner goes deeper on it: the preview must show what saving will give
    const cap = goalId === uncapped && !t.simplified ? null : t.approvedDepth;
    targets.push({
      goalId,
      capabilityId: t.capabilityId,
      nodeId: t.nodeId,
      idealDepth: Math.min(t.idealDepth, cap ?? 5) as Depth,
      weight: Math.min(1.6, 1 + 0.15 * Math.max(0, covered - 1)),
      core: t.core,
      requested: capability?.request != null,
    });
  }
  const targeted = new Set(targets.map((t) => t.nodeId));
  const depthOf = (id: string) => states.get(id)?.depth ?? 0;
  const planNodes = new Map<string, PlanNode>();
  // A premise outside every plan that still has to be owned first costs its time once, however many
  // planned ideas rest on it: it is charged to the first idea that needs it (the most central first,
  // since those are planned first), along the chain that adds the fewest premises not yet charged.
  const centralityOf = new Map([...targeted].map((id) => [id, graph.centrality(id)]));
  const charged = new Set<string>();
  for (const id of [...targeted].sort((a, b) => (centralityOf.get(b) ?? 0) - (centralityOf.get(a) ?? 0) || a.localeCompare(b))) {
    const node = nodes.get(id) as KnowledgeNode;
    const options = (graph.index.into.get(id) ?? []).map((c) => c.premises.filter((p) => !targeted.has(p) && depthOf(p) < OWNED_DEPTH && !charged.has(p)));
    const fresh = options.sort((a, b) => a.length - b.length)[0] ?? [];
    for (const p of fresh) charged.add(p);
    planNodes.set(id, { id, kind: node.kind, depth: depthOf(id), centrality: centralityOf.get(id) ?? 0, premiseMinutes: fresh.length * ideaMinutes('claim', 0, OWNED_DEPTH) });
  }
  return { goals, nodes, states, targets, planNodes, spent: base.spent, speed: base.speed };
}

/**
 * Minutes the cost model gives for what was learned toward a goal since it started (from its
 * baseline, up to each target's ideal depth), shared ideas split between the goals that hold them.
 */
function learnedMinutes(goal: Goal, targets: Pick<PlanTarget, 'goalId' | 'nodeId' | 'idealDepth'>[], nodes: Map<string, KnowledgeNode>, states: Map<string, NodeState>): number {
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

/** Allocations of the same inputs (kept while the database is unchanged) with the same budget are the same. */
const allocations = new WeakMap<PlanInputs, Map<string, Allocation>>();

function runAllocation(db: Database, inputs: PlanInputs, override?: { goalId: string; budget: GoalBudget | null }): Allocation {
  const key = override ? `${override.goalId}:${JSON.stringify(override.budget)}` : '';
  let kept = allocations.get(inputs);
  if (!kept) {
    kept = new Map();
    allocations.set(inputs, kept);
  }
  const hit = kept.get(key);
  if (hit) return hit;
  const allocation = allocate(planGoalsOf(db, inputs, override), inputs.targets, inputs.planNodes, inputs.speed);
  kept.set(key, allocation);
  return allocation;
}

function planGoalsOf(db: Database, inputs: PlanInputs, override?: { goalId: string; budget: GoalBudget | null }): PlanGoal[] {
  return inputs.goals.map((g) => {
    const budget = override && override.goalId === g.id ? override.budget : g.budget;
    return { id: g.id, budgetMinutes: goalBudgetMinutes(db, g, budget), spentMinutes: inputs.spent.get(g.id) ?? 0, priority: g.priority };
  });
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

export interface PlanPreview {
  plan: GoalPlan;
  /** Ideas in the preview with the depth the plan gives each (0: left out). */
  ideas: {
    nodeId: string;
    name: string;
    statement: string;
    kind: KnowledgeNode['kind'];
    plannedDepth: Depth;
    idealDepth: Depth;
    currentDepth: Depth;
    sharedWith: string[];
    skills: string[];
    simplified: string | null;
    /** Minutes the plan gives the idea, at the learner's speed; 0 when it is already there or left out. */
    minutes: number;
    /** Roughly which sessions it falls in (from 1), in an order where what it is built on comes first; null when nothing is left to learn of it. */
    sessions: { from: number; to: number } | null;
    /** Of its minutes, those for ideas outside the plan that it is built on and the learner does not own yet. */
    premiseMinutes: number;
  }[];
  /** True when the plan reaches every target at its full depth with time to spare: a bigger map would use it. */
  roomForMore: boolean;
}

/**
 * What a goal's plan looks like with a given budget, without saving anything: for the preview while
 * the learner sets the time, before approving. A new time lifts the approved caps (it is a new plan to
 * approve); `keepCaps` keeps them, for changes that keep the approved plan (an addition).
 */
export function previewPlan(db: Database, goalId: string, budget: GoalBudget | null, options: { keepCaps?: boolean } = {}): PlanPreview | null {
  const inputs = planInputs(db, { include: goalId, uncapped: options.keepCaps ? undefined : goalId });
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
      minutes: 0,
      sessions: null as { from: number; to: number } | null,
      premiseMinutes: 0,
    }))
    .sort((a, b) => b.plannedDepth - a.plannedDepth || b.idealDepth - a.idealDepth || a.name.localeCompare(b.name));
  // a rough roadmap: what each idea costs, and the session it would fall in when ideas are taken in an order they can be learned in
  const toLearn = ideas.filter((i) => i.plannedDepth > i.currentDepth);
  const learning = new Set(toLearn.map((i) => i.nodeId));
  const index = indexChains(listChains(db));
  for (const idea of toLearn) {
    const node = inputs.planNodes.get(idea.nodeId);
    const surcharge = idea.currentDepth === 0 ? (node?.premiseMinutes ?? 0) : 0;
    idea.minutes = Math.max(1, Math.round((ideaMinutes(idea.kind, idea.currentDepth, idea.plannedDepth) + surcharge) * inputs.speed));
    idea.premiseMinutes = Math.round(surcharge * inputs.speed);
  }
  const sessions = roadmap(
    toLearn.map((idea) => {
      // the chain into it that asks for the fewest ideas still to be learned
      const chains = (index.into.get(idea.nodeId) ?? []).map((c) => c.premises.filter((p) => learning.has(p)));
      return { id: idea.nodeId, minutes: idea.minutes, dependsOn: chains.sort((a, b) => a.length - b.length)[0] ?? [], weight: inputs.planNodes.get(idea.nodeId)?.centrality ?? 0 };
    }),
    SESSION_MINUTES,
  );
  for (const idea of toLearn) idea.sessions = sessions.get(idea.nodeId) ?? null;
  // the list reads top to bottom in learning order
  const position = new Map([...sessions.keys()].map((id, i) => [id, i]));
  ideas.sort((a, b) => (position.get(a.nodeId) ?? Infinity) - (position.get(b.nodeId) ?? Infinity));
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
  /**
   * Time the approved plan no longer uses (the learner knew more than planned for, or learned faster):
   * how many more ideas, and how many deeper, the same time would hold now. Null when there is none.
   */
  room: { more: number; deeper: number; minutes: number } | null;
}

/**
 * The goal's rhythm: when it began, the minutes that were left of the budget then, and the minutes a
 * week it asks for from there (null without a rhythm, and once the goal's date has passed).
 */
export function goalRhythm(db: Database, goal: Goal, shares = attributeTime(db).filter((s) => s.goalId === goal.id)): { start: string; left: number | null; weeklyTarget: number | null } {
  const start = goal.rhythmAt ?? goal.approvedAt ?? goal.createdAt;
  const total = goalBudgetMinutes(db, goal);
  const spentBefore = shares.filter((s) => s.span.endedAt < start).reduce((s, x) => s + x.minutes, 0);
  const left = total === null ? null : Math.max(0, total - spentBefore);
  return { start, left, weeklyTarget: weeklyMinutes(goal.budget, left, start, goal.date) };
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
  // the rhythm counts from when it began (approval, a new time, being taken up again), with the time that was left then
  const { start, left, weeklyTarget } = goalRhythm(db, goal, shares);
  const spentSinceStart = shares.filter((s) => s.span.endedAt >= start).reduce((s, x) => s + x.minutes, 0);
  const daysIn = Math.max(0, (now.getTime() - new Date(start).getTime()) / DAY_MS);
  const expectedByNow = weeklyTarget !== null ? Math.min(left ?? Infinity, (weeklyTarget * daysIn) / 7) : null;
  const span = budgetSpanDays(goal.budget);
  const endsOn = span !== null ? localDate(addDays(new Date(start), span)) : goal.date;
  const pace = paceOf({ budgetMinutes: total, spentMinutes, spentSinceStart, learnedMinutes: learnedMinutes(goal, inputs.targets, inputs.nodes, inputs.states), expectedByNow, daysIn });

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
    room: freedRoom(db, goal, plan, total, spentMinutes),
  };
}

/** Unplanned time worth offering back: at least this many minutes, about one idea. */
const ROOM_WORTH_MINUTES = 25;

/**
 * The approved plan is a ceiling: automatic re-plans never go past it (design §3.4). When the learner
 * turns out to know part of it, or learns faster, time is left over that the approved plan cannot
 * use. This says what the same time would hold if the plan were approved again from the goal's
 * ideal depths: the learner decides whether to use it.
 */
function freedRoom(db: Database, goal: Goal, plan: GoalPlan, total: number | null, spentMinutes: number): GoalProgress['room'] {
  if (goal.status !== 'active' || total === null) return null;
  const unused = total - spentMinutes - plan.plannedMinutes;
  if (unused < ROOM_WORTH_MINUTES) return null;
  const fresh = previewPlan(db, goal.id, goal.budget);
  if (!fresh) return null;
  const now = new Map<string, number>();
  for (const t of listTargets(db, goal.id, { all: true })) now.set(t.nodeId, Math.max(now.get(t.nodeId) ?? 0, t.depth));
  let more = 0;
  let deeper = 0;
  for (const idea of fresh.ideas) {
    const planned = now.get(idea.nodeId) ?? 0;
    if (idea.plannedDepth <= planned) continue;
    if (planned === 0) more += 1;
    else deeper += 1;
  }
  return more + deeper > 0 ? { more, deeper, minutes: Math.round(unused) } : null;
}

function startOfWeek(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
