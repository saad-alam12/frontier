/**
 * Time budgets (design §3.4): what the learner gives a goal, how it becomes one true total, what an
 * idea costs at each depth, how the budgets of all goals are spent on ideas (80/20 first, shared ideas
 * paid once), and whether the learner is on pace. Pure: the services feed it states and time spent.
 */
import type { Depth, GoalBudget, NodeKind } from './types';

const DAY_MS = 86_400_000;
export const SESSION_MINUTES = 45;

/** Days per unit of a rate budget's length. */
const LENGTH_DAYS = { days: 1, weeks: 7, months: 30.4 } as const;

/** The true total in minutes. A per-resource budget counts the goal's teaching resources (at least one). */
export function budgetMinutes(budget: GoalBudget | null, resources: number): number | null {
  if (!budget) return null;
  if (budget.mode === 'total') return Math.round(budget.hours * 60);
  if (budget.mode === 'resource') return Math.round(budget.hours * 60 * Math.max(1, resources));
  return Math.round(budget.hours * 60 * rateUnits(budget));
}

/** How many days or weeks a rate budget runs for. */
function rateUnits(budget: Extract<GoalBudget, { mode: 'rate' }>): number {
  const days = budget.length * LENGTH_DAYS[budget.lengthUnit];
  return budget.per === 'day' ? days : days / 7;
}

/** How long a rate budget runs, in days; null for the other modes. */
export function budgetSpanDays(budget: GoalBudget | null): number | null {
  if (!budget || budget.mode !== 'rate') return null;
  return Math.round(budget.length * LENGTH_DAYS[budget.lengthUnit]);
}

/** Minutes per week the budget asks for, when it has a rhythm: a rate, or a total spread to a date. */
export function weeklyMinutes(budget: GoalBudget | null, total: number | null, startIso: string, date: string | null): number | null {
  if (!budget || total === null) return null;
  if (budget.mode === 'rate') return Math.round(budget.hours * 60 * (budget.per === 'day' ? 7 : 1));
  if (!date) return null;
  const days = Math.max(1, (new Date(`${date}T23:59:59`).getTime() - new Date(startIso).getTime()) / DAY_MS);
  return Math.round((total / days) * 7);
}

/** "240 hours" plus how it was entered, for labels. */
export function describeBudget(budget: GoalBudget, resources: number, resourceNoun = 'lecture'): { total: string; detail: string } {
  const total = budgetMinutes(budget, resources) ?? 0;
  const hours = formatHours(total);
  if (budget.mode === 'total') return { total: hours, detail: 'in total' };
  if (budget.mode === 'resource') return { total: hours, detail: `${formatHours(budget.hours * 60)} per ${resourceNoun} × ${Math.max(1, resources)}` };
  const unit = budget.length === 1 ? budget.lengthUnit.replace(/s$/, '') : budget.lengthUnit;
  return { total: hours, detail: `${formatHours(budget.hours * 60)} a ${budget.per} for ${budget.length} ${unit}` };
}

export function formatHours(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} min`;
  const h = minutes / 60;
  const rounded = h >= 10 ? Math.round(h) : Math.round(h * 2) / 2;
  return `${rounded} ${rounded === 1 ? 'hour' : 'hours'}`;
}

// ---------------------------------------------------------------------------------------------
// What an idea costs

/**
 * Minutes of goal time to raise an idea one level, all in: the session's cards for it, a share of the
 * practice that keeps it, and some slack. Recognizing is a quick index pass (7); explaining runs
 * predict, explain, check and own words (25 in all); deriving adds a derive card (30 in all), so an
 * idea learned in depth costs about half an hour. Applying and transferring come from practice over
 * time. Terms cost half.
 */
export const LEVEL_MINUTES: readonly number[] = [0, 7, 18, 5, 8, 8];
/**
 * What a level is worth. Explaining an idea carries most of the use: a few ideas understood beat many
 * only recognized, so the plan takes the most useful ideas to the depth the goal asks before it adds
 * more ideas.
 */
export const LEVEL_VALUE: readonly number[] = [0, 0.35, 1, 0.45, 0.25, 0.15];
/** Targets the compiler marks core (the goal fails without them) weigh this much more. */
export const CORE_WEIGHT = 2;
/**
 * Targets of what the learner asked to add weigh this much more, on top of core: a fixed time makes
 * room for the request rather than leaving the request itself out.
 */
export const REQUESTED_WEIGHT = 1.5;
/** Goal minutes one idea learned in depth counts for; sizes the map the compiler is asked for. */
export const IDEA_MINUTES = 30;

/** Roughly how many ideas a budget holds: one per half hour, plus a fifth so the plan can choose (4–80). */
export function ideaCountFor(minutes: number): number {
  return Math.max(4, Math.min(80, Math.round((minutes / IDEA_MINUTES) * 1.2)));
}

export function levelMinutes(kind: NodeKind, level: number, speed = 1): number {
  return (LEVEL_MINUTES[level] ?? 0) * (kind === 'term' ? 0.5 : 1) * speed;
}

/** Minutes to take an idea from one depth to another. */
export function ideaMinutes(kind: NodeKind, from: number, to: number, speed = 1): number {
  let total = 0;
  for (let d = from + 1; d <= to; d += 1) total += levelMinutes(kind, d, speed);
  return total;
}

/**
 * How fast this learner learns compared with the cost model, from what they learned and the time it
 * took. 1 until there is enough to go on; kept within 0.6–2.5 so one slow week cannot wreck a plan.
 */
export function learnerSpeed(estimatedMinutes: number, actualMinutes: number): number {
  if (actualMinutes < 60 || estimatedMinutes < 20) return 1;
  return Math.max(0.6, Math.min(2.5, actualMinutes / estimatedMinutes));
}

// ---------------------------------------------------------------------------------------------
// Spending the budgets

export interface PlanGoal {
  id: string;
  /** Total budget in minutes; null means no budget (every target at its full depth). */
  budgetMinutes: number | null;
  /** Minutes already spent on the goal; the plan spends what is left. */
  spentMinutes: number;
  priority: number;
}

export interface PlanTarget {
  goalId: string;
  capabilityId: string;
  nodeId: string;
  /** The depth the compiler asked for. */
  idealDepth: Depth;
  /** How much the learner leans into this part (material keeps arriving on it); 1 by default. */
  weight?: number;
  /** The compiler marked it core: the goal fails without it. */
  core?: boolean;
  /** It belongs to something the learner asked to add to the goal. */
  requested?: boolean;
}

export interface PlanNode {
  id: string;
  kind: NodeKind;
  /** Current depth from evidence. */
  depth: Depth;
  /** How many ideas build on it (design §6); shared foundations come first. */
  centrality: number;
  /** Minutes for premises the goal does not target but that have to be learned first. */
  premiseMinutes?: number;
}

export interface GoalPlan {
  goalId: string;
  budgetMinutes: number | null;
  spentMinutes: number;
  /** Minutes of learning the plan still holds for this goal (its share of shared ideas). */
  plannedMinutes: number;
  /** Minutes it would take to reach every target at its full depth (its share). */
  fullMinutes: number;
  ideas: {
    /** Distinct ideas the goal's capabilities name. */
    total: number;
    /** Still to learn, planned at depth 2 or more (explained, derived, applied). */
    deep: number;
    /** Still to learn, planned at depth 1 (recognized). */
    overview: number;
    /** Left out entirely (planned depth 0). */
    cut: number;
    /** Planned below what the compiler asked. */
    trimmed: number;
    /** Already at their planned depth. */
    ready: number;
    /** Also targeted by another active goal. */
    shared: number;
  };
  sessions: number;
}

export interface Allocation {
  /** Planned depth per `${capabilityId}|${nodeId}`. */
  planned: Map<string, Depth>;
  /** Depth each idea is planned to reach overall. */
  nodeDepth: Map<string, Depth>;
  goals: Map<string, GoalPlan>;
}

export const targetKey = (capabilityId: string, nodeId: string) => `${capabilityId}|${nodeId}`;

interface Level {
  nodeId: string;
  level: number;
  cost: number;
  ratio: number;
  /** Goals that want the idea at least this deep. */
  wanting: string[];
}

/**
 * Spend every goal's remaining budget on idea levels, best value per minute first (design §6).
 * Value is goal priority × part weight × core weight × requested weight × (1 + log centrality) × the
 * level's value. An idea climbs to the depth the goal asks once its first level is bought (explaining and deriving are
 * worth more per minute than recognizing), so the most useful ideas are learned properly before more
 * ideas join, and core ideas and shared foundations come before goal-specific detail.
 * An idea several goals want is paid once, split between the goals that can afford it; a goal that
 * cannot pay its share still gets the idea when another goal pays for it. What the learner already
 * knows is free. Goals without a budget get every target at its full depth.
 */
export function allocate(goals: PlanGoal[], targets: PlanTarget[], nodes: Map<string, PlanNode>, speed = 1): Allocation {
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const live = targets.filter((t) => goalById.has(t.goalId) && nodes.has(t.nodeId));
  const remaining = new Map(goals.map((g) => [g.id, g.budgetMinutes === null ? Infinity : Math.max(0, g.budgetMinutes - g.spentMinutes)]));

  // per idea: how deep each goal wants it, and the goal's weight on it
  const wants = new Map<string, Map<string, { depth: number; weight: number }>>();
  for (const t of live) {
    const byGoal = wants.get(t.nodeId) ?? new Map<string, { depth: number; weight: number }>();
    const prev = byGoal.get(t.goalId);
    const weight = (t.weight ?? 1) * (t.core ? CORE_WEIGHT : 1) * (t.requested ? REQUESTED_WEIGHT : 1);
    byGoal.set(t.goalId, { depth: Math.max(prev?.depth ?? 0, t.idealDepth), weight: Math.max(prev?.weight ?? 0, weight) });
    wants.set(t.nodeId, byGoal);
  }

  const levels: Level[] = [];
  for (const [nodeId, byGoal] of wants) {
    const node = nodes.get(nodeId) as PlanNode;
    const top = Math.max(...[...byGoal.values()].map((w) => w.depth));
    const reach = 1 + Math.log1p(Math.max(0, node.centrality));
    for (let level = node.depth + 1; level <= top; level += 1) {
      const wanting = [...byGoal.entries()].filter(([, w]) => w.depth >= level).map(([g]) => g);
      const value = wanting.reduce((s, g) => s + (goalById.get(g)?.priority ?? 1) * (byGoal.get(g)?.weight ?? 1), 0) * reach * (LEVEL_VALUE[level] ?? 0);
      const cost = levelMinutes(node.kind, level, speed) + (level === 1 ? (node.premiseMinutes ?? 0) * speed : 0);
      levels.push({ nodeId, level, cost, ratio: value / Math.max(cost, 0.5), wanting });
    }
  }
  levels.sort((a, b) => b.ratio - a.ratio || a.level - b.level || a.nodeId.localeCompare(b.nodeId));

  const reached = new Map<string, number>([...nodes.values()].map((n) => [n.id, n.depth]));
  const paid = new Map<string, number>(goals.map((g) => [g.id, 0]));
  const stopped = new Set<string>();
  // A deeper level can outrank its shallower one (premises make the first level dear): it waits for it.
  const waiting = new Map<string, Level>();
  const tryLevel = (l: Level): boolean => {
    let payers = l.wanting;
    for (let round = 0; round < l.wanting.length && payers.length; round += 1) {
      const share = l.cost / payers.length;
      const able = payers.filter((g) => (remaining.get(g) ?? 0) >= share);
      if (able.length === payers.length) break;
      payers = able;
    }
    if (!payers.length) return false;
    const share = l.cost / payers.length;
    for (const g of payers) {
      remaining.set(g, (remaining.get(g) ?? 0) - share);
      paid.set(g, (paid.get(g) ?? 0) + share);
    }
    reached.set(l.nodeId, l.level);
    return true;
  };
  for (const first of levels) {
    let l: Level | undefined = first;
    while (l) {
      if (stopped.has(l.nodeId)) break;
      if ((reached.get(l.nodeId) ?? 0) < l.level - 1) {
        waiting.set(`${l.nodeId}|${l.level}`, l);
        break;
      }
      if (!tryLevel(l)) {
        stopped.add(l.nodeId); // a level that does not fit ends the idea's climb
        break;
      }
      const next = `${l.nodeId}|${l.level + 1}`;
      l = waiting.get(next);
      waiting.delete(next);
    }
  }

  const planned = new Map<string, Depth>();
  const nodeDepth = new Map<string, Depth>();
  for (const [nodeId, depth] of reached) if (wants.has(nodeId)) nodeDepth.set(nodeId, depth as Depth);
  for (const t of live) planned.set(targetKey(t.capabilityId, t.nodeId), Math.min(t.idealDepth, reached.get(t.nodeId) ?? 0) as Depth);

  const goalsOf = new Map<string, number>();
  for (const [nodeId, byGoal] of wants) goalsOf.set(nodeId, byGoal.size);
  const plans = new Map<string, GoalPlan>();
  for (const g of goals) {
    const mine = [...wants.entries()].filter(([, byGoal]) => byGoal.has(g.id));
    let deep = 0;
    let overview = 0;
    let cut = 0;
    let trimmed = 0;
    let ready = 0;
    let shared = 0;
    let fullMinutes = 0;
    for (const [nodeId, byGoal] of mine) {
      const node = nodes.get(nodeId) as PlanNode;
      const want = byGoal.get(g.id)?.depth ?? 0;
      const depth = Math.min(want, reached.get(nodeId) ?? 0);
      if (depth === 0) cut += 1;
      else if (node.depth >= depth) ready += 1;
      else if (depth >= 2) deep += 1;
      else overview += 1;
      if (depth < want) trimmed += 1;
      if ((goalsOf.get(nodeId) ?? 1) > 1) shared += 1;
      const premises = node.depth < 1 && want >= 1 ? (node.premiseMinutes ?? 0) * speed : 0;
      fullMinutes += (ideaMinutes(node.kind, node.depth, want, speed) + premises) / (goalsOf.get(nodeId) ?? 1);
    }
    const plannedMinutes = paid.get(g.id) ?? 0;
    plans.set(g.id, {
      goalId: g.id,
      budgetMinutes: g.budgetMinutes,
      spentMinutes: g.spentMinutes,
      plannedMinutes: Math.round(plannedMinutes),
      fullMinutes: Math.round(fullMinutes),
      ideas: { total: mine.length, deep, overview, cut, trimmed, ready, shared },
      sessions: Math.ceil(plannedMinutes / SESSION_MINUTES),
    });
  }
  return { planned, nodeDepth, goals: plans };
}

// ---------------------------------------------------------------------------------------------
// Pace

export type PaceKind = 'unknown' | 'on_track' | 'behind_time' | 'slow' | 'fast';

export interface PaceInput {
  budgetMinutes: number | null;
  spentMinutes: number;
  /** Minutes the cost model gives for what was learned for this goal since it started. */
  learnedMinutes: number;
  /** Minutes the budget's rhythm expects by now (rate budgets and dated totals); null otherwise. */
  expectedByNow: number | null;
  /** Days since the goal started. */
  daysIn: number;
}

export interface Pace {
  kind: PaceKind;
  /** Spent ÷ estimated for what was learned; above 1 means slower than planned. */
  ratio: number | null;
}

/**
 * Says behind, slow or fast only when it is clear: the error bars are wide, so nothing is said in the
 * first fifth of the budget or the first hour, and only a factor of two counts. Falling behind on
 * hours needs two weeks in and less than half of what the rhythm asked for.
 */
export function paceOf(input: PaceInput): Pace {
  const ratio = input.learnedMinutes > 0 ? input.spentMinutes / input.learnedMinutes : null;
  if (input.expectedByNow !== null && input.daysIn >= 14 && input.expectedByNow >= 120 && input.spentMinutes < input.expectedByNow * 0.5) return { kind: 'behind_time', ratio };
  const enough = input.spentMinutes >= 60 && (input.budgetMinutes === null || input.spentMinutes >= input.budgetMinutes * 0.2);
  if (!enough) return { kind: 'unknown', ratio };
  if (ratio === null || ratio > 2) return { kind: 'slow', ratio };
  if (ratio < 0.5) return { kind: 'fast', ratio };
  return { kind: 'on_track', ratio };
}
