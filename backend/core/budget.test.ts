import { describe, expect, it } from 'vitest';
import { allocate, budgetMinutes, budgetSpanDays, describeBudget, ideaMinutes, learnerSpeed, paceOf, weeklyMinutes } from './budget';
import type { PlanGoal, PlanNode, PlanTarget } from './budget';
import type { Depth } from './types';

/** A goal with `n` ideas: a few central foundations and many leaves, each wanted at `depth`. */
function course(goalId: string, n: number, depth: Depth, prefix = goalId): { targets: PlanTarget[]; nodes: PlanNode[] } {
  const nodes: PlanNode[] = [];
  const targets: PlanTarget[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = `${prefix}${i}`;
    nodes.push({ id, kind: i % 4 === 3 ? 'term' : 'claim', depth: 0, centrality: i < 3 ? 6 : 0 });
    targets.push({ goalId, capabilityId: `${goalId}-cap${i % 3}`, nodeId: id, idealDepth: depth });
  }
  return { targets, nodes };
}

const goal = (id: string, hours: number | null, spent = 0): PlanGoal => ({ id, budgetMinutes: hours === null ? null : hours * 60, spentMinutes: spent, priority: 1 });
const byId = (nodes: PlanNode[]) => new Map(nodes.map((n) => [n.id, n]));

describe('budget totals', () => {
  it('resolves every way of giving time to one true total', () => {
    expect(budgetMinutes({ mode: 'total', hours: 20 }, 0)).toBe(1200);
    expect(budgetMinutes({ mode: 'rate', hours: 10, per: 'week', length: 6, lengthUnit: 'months' }, 0)).toBe(Math.round(10 * 60 * ((6 * 30.4) / 7)));
    expect(budgetMinutes({ mode: 'rate', hours: 1, per: 'day', length: 1, lengthUnit: 'months' }, 0)).toBe(Math.round(60 * 30.4));
    expect(budgetMinutes({ mode: 'rate', hours: 6, per: 'day', length: 2, lengthUnit: 'weeks' }, 0)).toBe(6 * 60 * 14);
    // two hours per lecture grows with the lectures; with none yet it counts one
    expect(budgetMinutes({ mode: 'resource', hours: 2 }, 0)).toBe(120);
    expect(budgetMinutes({ mode: 'resource', hours: 2 }, 12)).toBe(1440);
    expect(budgetMinutes(null, 3)).toBeNull();
    expect(budgetSpanDays({ mode: 'rate', hours: 6, per: 'day', length: 2, lengthUnit: 'weeks' })).toBe(14);
  });

  it('describes a budget the way it was given', () => {
    expect(describeBudget({ mode: 'rate', hours: 10, per: 'week', length: 6, lengthUnit: 'months' }, 0)).toEqual({ total: '261 hours', detail: '10 hours a week for 6 months' });
    expect(describeBudget({ mode: 'resource', hours: 2 }, 5)).toEqual({ total: '10 hours', detail: '2 hours per lecture × 5' });
    expect(describeBudget({ mode: 'total', hours: 1.5 }, 0).total).toBe('1.5 hours');
  });

  it('gives a weekly rhythm for rates and for totals with a date', () => {
    expect(weeklyMinutes({ mode: 'rate', hours: 2, per: 'week', length: 12, lengthUnit: 'weeks' }, 1440, '2026-10-01T00:00:00Z', null)).toBe(120);
    expect(weeklyMinutes({ mode: 'rate', hours: 6, per: 'day', length: 2, lengthUnit: 'weeks' }, 5040, '2026-10-01T00:00:00Z', null)).toBe(2520);
    expect(weeklyMinutes({ mode: 'total', hours: 20 }, 1200, '2026-10-01T00:00:00Z', null)).toBeNull();
    expect(weeklyMinutes({ mode: 'total', hours: 20 }, 1200, '2026-10-01T00:00:00Z', '2026-10-14')).toBeGreaterThan(550);
  });
});

describe('allocate', () => {
  it('sizes the map to the time: two hours gives an overview, many hours a deep map', () => {
    const { targets, nodes } = course('g', 40, 4);
    const small = allocate([goal('g', 2)], targets, byId(nodes)).goals.get('g');
    const large = allocate([goal('g', 240)], targets, byId(nodes)).goals.get('g');
    if (!small || !large) throw new Error('no plan');
    expect(small.plannedMinutes).toBeLessThanOrEqual(120);
    expect(small.ideas.deep).toBeLessThan(5);
    expect(small.ideas.trimmed).toBeGreaterThan(30);
    expect(small.sessions).toBeLessThanOrEqual(3);
    expect(large.ideas.trimmed).toBe(0);
    expect(large.ideas.deep).toBe(40);
    expect(large.sessions).toBeGreaterThan(small.sessions * 5);
  });

  it('spends a small budget on breadth before depth (80/20) and on foundations first', () => {
    const { targets, nodes } = course('g', 20, 3);
    const plan = allocate([goal('g', 1.5)], targets, byId(nodes));
    const depths = nodes.map((n) => plan.nodeDepth.get(n.id) ?? 0);
    // most ideas are at least recognized before any is derived
    expect(depths.filter((d) => d >= 1).length).toBeGreaterThan(15);
    // the central ideas (0–2) are the ones that go deeper
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(depths.slice(0, 3))).toBeGreaterThan(mean(depths.slice(3)) + 0.5);
  });

  it('never throws away what the learner knows, and known ideas cost nothing', () => {
    const { targets, nodes } = course('g', 10, 3);
    const known = nodes.map((n, i) => (i < 5 ? { ...n, depth: 3 as Depth } : n));
    const fresh = allocate([goal('g', 0.5)], targets, byId(nodes)).goals.get('g');
    const plan = allocate([goal('g', 0.5)], targets, byId(known));
    expect(plan.goals.get('g')?.ideas.ready).toBe(5);
    for (const n of known.slice(0, 5)) expect(plan.nodeDepth.get(n.id)).toBe(3);
    // the same half hour now goes further
    expect(plan.goals.get('g')?.ideas.trimmed).toBeLessThan(fresh?.ideas.trimmed ?? 0);
  });

  it('spends only what is left: time already spent shrinks the plan', () => {
    const { targets, nodes } = course('g', 20, 4);
    const before = allocate([goal('g', 10)], targets, byId(nodes)).goals.get('g');
    const after = allocate([goal('g', 10, 420)], targets, byId(nodes)).goals.get('g');
    expect(after?.plannedMinutes).toBeLessThan(before?.plannedMinutes ?? 0);
    expect(after?.plannedMinutes).toBeLessThanOrEqual(180);
  });

  it('pays for a shared idea once, split between the goals that need it', () => {
    const calculus: PlanNode = { id: 'calc', kind: 'claim', depth: 0, centrality: 8 };
    const physics = course('physics', 6, 2);
    const ml = course('ml', 6, 2);
    const targets = [...physics.targets, ...ml.targets, { goalId: 'physics', capabilityId: 'physics-cap0', nodeId: 'calc', idealDepth: 3 as Depth }, { goalId: 'ml', capabilityId: 'ml-cap0', nodeId: 'calc', idealDepth: 3 as Depth }];
    const nodes = byId([...physics.nodes, ...ml.nodes, calculus]);
    const both = allocate([goal('physics', 50), goal('ml', 50)], targets, nodes);
    const alone = allocate([goal('physics', 50)], targets.filter((t) => t.goalId === 'physics'), nodes);
    const calcMinutes = ideaMinutes('claim', 0, 3);
    expect(both.nodeDepth.get('calc')).toBe(3);
    expect(both.goals.get('physics')?.ideas.shared).toBe(1);
    // each goal pays half of calculus
    expect((alone.goals.get('physics')?.plannedMinutes ?? 0) - (both.goals.get('physics')?.plannedMinutes ?? 0)).toBeCloseTo(calcMinutes / 2, 0);
    // all goals together spend calculus once
    const total = [...both.goals.values()].reduce((s, g) => s + g.plannedMinutes, 0);
    const separate = (alone.goals.get('physics')?.plannedMinutes ?? 0) * 2;
    expect(separate - total).toBeCloseTo(calcMinutes, 0);
  });

  it('lets a goal with no time left use an idea another goal pays for', () => {
    const targets: PlanTarget[] = [
      { goalId: 'rich', capabilityId: 'r', nodeId: 'calc', idealDepth: 3 },
      { goalId: 'broke', capabilityId: 'b', nodeId: 'calc', idealDepth: 3 },
    ];
    const plan = allocate([goal('rich', 10), goal('broke', 0)], targets, byId([{ id: 'calc', kind: 'claim', depth: 0, centrality: 2 }]));
    expect(plan.planned.get('b|calc')).toBe(3);
    expect(plan.goals.get('broke')?.plannedMinutes).toBe(0);
  });

  it('never plans more than reaching every target fully would take', () => {
    const { targets, nodes } = course('g', 15, 4);
    const withPremises = nodes.map((n, i) => ({ ...n, premiseMinutes: i % 2 ? 8 : 0 }));
    const plan = allocate([goal('g', 500)], targets, byId(withPremises)).goals.get('g');
    expect(plan?.plannedMinutes).toBeLessThanOrEqual((plan?.fullMinutes ?? 0) + 1);
    expect(plan?.ideas.trimmed).toBe(0);
  });

  it('plans every target at full depth for a goal with no budget', () => {
    const { targets, nodes } = course('g', 12, 5);
    const plan = allocate([goal('g', null)], targets, byId(nodes));
    expect([...plan.planned.values()].every((d) => d === 5)).toBe(true);
  });
});

describe('pace', () => {
  const base = { budgetMinutes: 1200, spentMinutes: 0, learnedMinutes: 0, expectedByNow: null, daysIn: 3 };
  it('says nothing until there is enough to go on', () => {
    expect(paceOf({ ...base, spentMinutes: 50, learnedMinutes: 5 }).kind).toBe('unknown');
    expect(paceOf({ ...base, spentMinutes: 200, learnedMinutes: 20 }).kind).toBe('unknown'); // under a fifth of the budget
  });
  it('calls slow or fast only at a factor of two', () => {
    expect(paceOf({ ...base, spentMinutes: 300, learnedMinutes: 200 }).kind).toBe('on_track');
    expect(paceOf({ ...base, spentMinutes: 300, learnedMinutes: 140 }).kind).toBe('slow');
    expect(paceOf({ ...base, spentMinutes: 300, learnedMinutes: 700 }).kind).toBe('fast');
  });
  it('flags falling behind on hours only after two weeks at under half the rhythm', () => {
    expect(paceOf({ ...base, expectedByNow: 600, spentMinutes: 200, daysIn: 10 }).kind).not.toBe('behind_time');
    expect(paceOf({ ...base, expectedByNow: 600, spentMinutes: 200, daysIn: 15 }).kind).toBe('behind_time');
    expect(paceOf({ ...base, expectedByNow: 600, spentMinutes: 320, learnedMinutes: 300, daysIn: 15 }).kind).toBe('on_track');
  });
  it('estimates the learner speed only from enough time', () => {
    expect(learnerSpeed(10, 30)).toBe(1);
    expect(learnerSpeed(100, 150)).toBe(1.5);
    expect(learnerSpeed(100, 1000)).toBe(2.5);
  });
});
