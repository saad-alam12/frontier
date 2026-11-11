import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { listActivity, logTime } from '../store/activity';
import { openDatabase } from '../store/db';
import { addCapabilities, getGoal, listTargets } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { listSources } from '../store/sources';
import { listNodes } from '../store/world';
import { tick } from './activity';
import { attributeTime, freezeTimeOwners, goalProgress, learnerSpeedNow, previewPlan, spentByGoal, timeOwners } from './budget';
import { recordEvidence } from './evidence';
import { approveGoalPlan, compileGoal, createGoalFromForm, goalDetail, setGoalStatus, updateGoalFromForm, useFreedTime } from './goals';
import { addExtraMinutes, capTargets, deleteGoal, setMaterials } from '../store/goals';
import { createSource, updateSourceStatus } from '../store/sources';
import { GoalWorker, nextGoalStep } from './goalWorker';
import { submitProbe } from './probe';
import { refreshGoalFields } from './knowledge';
import { candidatesForGoal } from './planner';
import { createProbe } from './probe';
import { statsView } from './stats';

const DAY = 86_400_000;

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (k: string) => ids.get(k) as string;
  return { db, id };
}

/** A game theory goal with four capabilities over the seed graph, wanting depth 3–4 throughout. */
function gameTheory(db: ReturnType<typeof setup>['db'], id: (k: string) => string, hours: number | null, text = 'Pass the game theory exam') {
  const goal = createGoalFromForm(db, { text, kind: 'course', assessment: 'written_exam', budget: hours === null ? null : { mode: 'total', hours }, materials: [] });
  addCapabilities(db, goal.id, [
    { statement: 'Can find Nash equilibria', targets: ['nash', 'bestResponse', 'findPureNash', 'nashMutualBr'].map((k) => ({ nodeId: id(k), depth: 4 as const })) },
    { statement: 'Can use dominance', targets: ['dominant', 'dominated', 'iesds', 'dominantNash', 'pdUnique'].map((k) => ({ nodeId: id(k), depth: 3 as const })) },
    { statement: 'Can solve sequential games', targets: ['spe', 'backwardInduction'].map((k) => ({ nodeId: id(k), depth: 3 as const })) },
    { statement: 'Can find mixed equilibria', targets: [{ nodeId: id('mixedIndifference'), depth: 4 as const }] },
  ]);
  refreshGoalFields(db);
  return goal;
}

describe('time budgets', () => {
  it('trims the plan to a small budget and grows it when the time grows, keeping the ideal depths', () => {
    const { db, id } = setup();
    const goal = gameTheory(db, id, 1);
    const all = listTargets(db, goal.id, { all: true });
    expect(all.every((t) => t.depth <= t.idealDepth)).toBe(true);
    expect(all.some((t) => t.depth < t.idealDepth)).toBe(true);
    const small = goalDetail(db, goal.id)?.progress;
    expect(small?.plan.plannedMinutes).toBeLessThanOrEqual(60);
    expect(small?.plan.sessions).toBeLessThanOrEqual(2);
    expect(small?.plan.ideas.trimmed).toBeGreaterThan(0);

    updateGoalFromForm(db, goal.id, { budget: { mode: 'rate', hours: 3, per: 'week', length: 10, lengthUnit: 'weeks' } });
    const large = goalDetail(db, goal.id);
    expect(large?.progress?.plan.ideas.trimmed).toBe(0);
    expect(listTargets(db, goal.id).every((t) => t.depth === t.idealDepth)).toBe(true);
    expect(large?.progress?.weeklyTarget).toBe(180);
    expect(listActivity(db, { kinds: ['budget.changed'] })).toHaveLength(1);
  });

  it('previews a draft with any budget without saving, and approval starts its clock and baseline', () => {
    const { db, id } = setup();
    const draft = createGoalFromForm(db, { text: 'Learn game theory basics', budget: { mode: 'total', hours: 2 }, materials: [] }, { draft: true });
    addCapabilities(db, draft.id, [{ statement: 'Can find Nash equilibria', targets: ['nash', 'bestResponse', 'dominant', 'spe'].map((k) => ({ nodeId: id(k), depth: 3 as const })) }]);
    recordEvidence(db, { nodeId: id('bestResponse'), kind: 'derive', score: 1, reasoning: 'knew it' });
    refreshGoalFields(db);
    expect(goalDetail(db, draft.id)?.schedule).toBeNull(); // drafts are not scheduled

    const tiny = previewPlan(db, draft.id, { mode: 'total', hours: 0.25 });
    const roomy = previewPlan(db, draft.id, { mode: 'total', hours: 20 });
    expect(tiny?.plan.ideas.trimmed).toBeGreaterThan(0);
    expect(roomy?.plan.ideas.trimmed).toBe(0);
    expect(roomy?.roomForMore).toBe(true);
    expect(tiny?.ideas.find((i) => i.nodeId === id('bestResponse'))?.currentDepth).toBeGreaterThan(0);
    expect(getGoal(db, draft.id)?.budget).toEqual({ mode: 'total', hours: 2 }); // nothing saved

    approveGoalPlan(db, draft.id);
    const active = getGoal(db, draft.id);
    expect(active?.status).toBe('active');
    expect(active?.approvedAt).not.toBeNull();
    expect(active?.baseline[id('bestResponse')]).toBeGreaterThan(0);
    expect(active?.baseline[id('nash')]).toBe(0);
  });

  it('counts a shared idea once: its time is split and its cost shared between the goals', () => {
    const { db, id } = setup();
    const exam = gameTheory(db, id, 6, 'Pass the game theory exam');
    const econ = createGoalFromForm(db, { text: 'Understand oligopoly pricing', budget: { mode: 'total', hours: 6 }, materials: [] });
    addCapabilities(db, econ.id, [{ statement: 'Can analyse price competition', targets: [{ nodeId: id('nash'), depth: 4 }, { nodeId: id('pdUnique'), depth: 3 }] }]);
    refreshGoalFields(db);
    const shared = goalProgress(db, econ.id)?.plan.ideas.shared;
    expect(shared).toBe(2);

    const now = new Date();
    logTime(db, 'session', { goalId: exam.id, nodeId: id('nash') }, 600, now);
    logTime(db, 'session', { goalId: exam.id, nodeId: id('spe') }, 600, now);
    const spent = spentByGoal(attributeTime(db));
    expect(spent.get(econ.id)).toBeCloseTo(5); // half of the ten minutes on Nash
    expect(spent.get(exam.id)).toBeCloseTo(15);
    expect([...spent.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(20); // nothing double counted
  });

  it('books ticks to the session, the practice set or the screen, merging continuous time into spans', () => {
    const { db, id } = setup();
    const goal = gameTheory(db, id, 5);
    const t0 = Date.now();
    tick(db, { surface: 'probe', seconds: 15, goalId: goal.id }, new Date(t0));
    tick(db, { surface: 'probe', seconds: 15, goalId: goal.id }, new Date(t0 + 15_000));
    tick(db, { surface: 'probe', seconds: 15, goalId: goal.id }, new Date(t0 + 120_000)); // after a break: a new span
    tick(db, { surface: 'map', seconds: 15 }, new Date(t0 + 135_000));
    tick(db, { surface: 'session', seconds: 15 }, new Date(t0 + 150_000)); // no session open: ignored
    tick(db, { surface: 'probe', seconds: 600, goalId: goal.id }, new Date(t0 + 160_000)); // a stalled renderer is capped
    const spans = listActivity(db, { kinds: ['time'] });
    expect(spans.map((s) => s.seconds).sort((a, b) => a - b)).toEqual([15, 15, 30, 60]);
    expect(goalProgress(db, goal.id)?.spentMinutes).toBe(2); // the map is not study
  });

  it('says nothing about pace early, and flags clearly slow progress once enough time is in', () => {
    const { db, id } = setup();
    const goal = gameTheory(db, id, 5);
    approveGoalPlan(db, goal.id);
    expect(goalProgress(db, goal.id)?.pace.kind).toBe('unknown');
    // two hours in, one idea recognized
    logTime(db, 'session', { goalId: goal.id, nodeId: id('nash') }, 7200, new Date());
    recordEvidence(db, { nodeId: id('nash'), kind: 'explain', score: 0.4, reasoning: 'shaky' });
    expect(goalProgress(db, goal.id)?.pace.kind).toBe('slow');
  });
});

describe('shared ideas once learned', () => {
  it('are not probed again for another goal', async () => {
    const { db, id } = setup();
    const goal = gameTheory(db, id, 20);
    // owned at depth 4 from earlier work (another goal), fresh
    for (let i = 0; i < 3; i += 1) recordEvidence(db, { nodeId: id('nash'), kind: 'use', score: 1, reasoning: 'used it' });
    refreshGoalFields(db);
    const provider = new FakeProvider({
      prober: (req: CompleteRequest<unknown>) => {
        const text = req.messages[0]?.content ?? '';
        // it may appear as a premise of another idea, never as a candidate of its own
        expect(text).not.toMatch(new RegExp(`^- \\[${id('nash')}\\]`, 'm'));
        expect(text).toMatch(/^- \[node_/m);
        const first = /- \[(node_[a-z0-9_]+)\]/.exec(text)?.[1] as string;
        return { questions: [{ nodeId: first, question: 'Why does this hold?', kind: 'explain' }] };
      },
    });
    await createProbe(db, provider, goal.id, 1).catch((e: Error) => {
      // a schema mismatch in this fake is fine; what matters is what the prober was shown
      if (!/payload|invalid/.test(e.message)) throw e;
    });
    expect(provider.calls.filter((c) => c.role === 'prober')).not.toHaveLength(0);
  });
});

describe('approved plans', () => {
  it('never re-plans deeper than the plan the learner approved, and re-approves when the time changes', () => {
    const { db, id } = setup();
    const draft = createGoalFromForm(db, { text: 'Learn game theory basics', budget: { mode: 'total', hours: 1 }, materials: [] }, { draft: true });
    addCapabilities(db, draft.id, [{ statement: 'Can find Nash equilibria', targets: ['nash', 'bestResponse', 'dominant', 'spe', 'profile'].map((k) => ({ nodeId: id(k), depth: 3 as const })) }]);
    approveGoalPlan(db, draft.id);
    const approved = new Map(listTargets(db, draft.id, { all: true }).map((t) => [t.nodeId, t.depth]));
    expect([...approved.values()].some((d) => d < 3)).toBe(true);
    expect(listTargets(db, draft.id, { all: true }).every((t) => t.approvedDepth === t.depth)).toBe(true);

    // the learner turns out to know two ideas: the time they free is not spent going deeper than approved
    recordEvidence(db, { nodeId: id('bestResponse'), kind: 'derive', score: 1, reasoning: 'knew it' });
    recordEvidence(db, { nodeId: id('profile'), kind: 'derive', score: 1, reasoning: 'knew it' });
    refreshGoalFields(db);
    for (const t of listTargets(db, draft.id, { all: true })) expect(t.depth).toBeLessThanOrEqual(approved.get(t.nodeId) ?? 0);

    // a new time is a new plan: it goes back to the ideal depths, then holds there
    updateGoalFromForm(db, draft.id, { budget: { mode: 'total', hours: 20 } });
    expect(listTargets(db, draft.id, { all: true }).every((t) => t.depth === t.idealDepth && t.approvedDepth === t.idealDepth)).toBe(true);
  });

  it('previews exactly the time given: ten hours never plans more than ten hours (owner screenshot, R2)', () => {
    const { db } = setup();
    const draft = createGoalFromForm(db, { text: 'Understand how LLMs work', budget: { mode: 'total', hours: 10 }, materials: [] }, { draft: true });
    const nodes = listNodes(db).slice(0, 34);
    addCapabilities(db, draft.id, [0, 1, 2, 3].map((c) => ({ statement: `Can explain part ${c + 1}`, targets: nodes.filter((_, i) => i % 4 === c).map((n) => ({ nodeId: n.id, depth: 3 as const })) })));
    const preview = previewPlan(db, draft.id, { mode: 'total', hours: 10 });
    const plan = preview?.plan;
    expect(plan?.plannedMinutes).toBeLessThanOrEqual(600);
    expect(plan?.sessions).toBeLessThanOrEqual(14);
    expect((plan?.ideas.deep ?? 0) + (plan?.ideas.overview ?? 0) + (plan?.ideas.ready ?? 0) + (plan?.ideas.cut ?? 0)).toBe(plan?.ideas.total);
    expect(plan?.ideas.cut).toBeGreaterThan(0);
    // half an hour per claim learned in depth (terms half): at most twenty claims fit ten hours
    expect(preview?.ideas.filter((i) => i.plannedDepth > 0 && i.kind !== 'term').length).toBeLessThanOrEqual(20);
  });
});

describe('compiling with a budget', () => {
  it('sizes the request to the time, records coverage, and teaches self-built ideas for a fragment', async () => {
    const { db, id } = setup();
    const goal = createGoalFromForm(db, { text: 'Understand the attention paper and what it builds on', kind: 'personal', budget: { mode: 'total', hours: 2 }, focus: ['concepts'], materials: [{ sourceId: listSources(db)[0]?.id as string, role: 'teaching' }] }, { draft: true });
    const provider = new FakeProvider({
      goalCompiler: (req: CompleteRequest<unknown>) => {
        const text = req.messages[0]?.content ?? '';
        expect(text).toContain('about 2 hours in total');
        expect(text).toContain('about 5 ideas in all');
        expect(text).toContain('conceptual understanding');
        expect(text).toContain('## Coverage');
        return {
          title: 'Attention',
          level: 'intuition',
          scope: 'In 2 hours: how attention lets each word take in the others, in plain words.',
          coverage: 'fragment',
          capabilities: [{ statement: 'Can explain how one player best responds to another', targets: [{ ref: id('bestResponse'), depth: 2 }, { ref: 'm1', depth: 2 }] }],
          newNodes: [{ tempId: 'm1', kind: 'term', name: 'Softmax weighting', statement: 'Turning scores into weights that sum to one.' }],
        };
      },
    });
    await compileGoal({ db, provider }, goal.id);
    expect(getGoal(db, goal.id)?.coverage).toBe('fragment');
    const softmax = listNodes(db).find((n) => n.name === 'Softmax weighting');
    expect(softmax?.status).toBe('unverified');
    approveGoalPlan(db, goal.id);
    const { candidates } = candidatesForGoal(db, goal.id);
    expect(candidates.map((c) => c.nodeId)).toContain(softmax?.id);
  });
});

describe('stats', () => {
  it('summarizes time, growth, calibration and overlap, with plain facts', () => {
    const { db, id } = setup();
    const exam = gameTheory(db, id, 10);
    const econ = createGoalFromForm(db, { text: 'Understand oligopoly pricing', budget: { mode: 'total', hours: 6 }, materials: [] });
    addCapabilities(db, econ.id, [{ statement: 'Can analyse price competition', targets: [{ nodeId: id('nash'), depth: 4 }, { nodeId: id('pdUnique'), depth: 3 }] }]);
    refreshGoalFields(db);
    const now = new Date();
    for (let d = 0; d < 4; d += 1) logTime(db, 'session', { goalId: exam.id, nodeId: id('nash') }, 1800, new Date(now.getTime() - d * DAY));
    for (const [k, score, conf] of [['nash', 0.95, 0.9], ['nash', 0.9, 0.9], ['bestResponse', 0.9, 0.9], ['dominant', 0.85, 0.9], ['pdUnique', 1, 0.9], ['spe', 0.3, 0.33], ['spe', 0.2, 0.33]] as [string, number, number][]) {
      recordEvidence(db, { nodeId: id(k), kind: 'derive', score, confidence: conf, reasoning: 'r', at: new Date(now.getTime() - DAY).toISOString() });
    }
    const view = statsView(db, { goalId: null, topicId: null, range: '30d' }, now);
    expect(view.headline.minutes).toBe(120);
    expect(view.headline.streakDays).toBeGreaterThanOrEqual(3);
    expect(view.calibration.find((c) => c.confidence === 0.9)?.count).toBe(5);
    expect(view.hardest[0]?.nodeId).toBe(id('spe'));
    expect(view.overlap.ideas.map((o) => o.nodeId)).toContain(id('nash'));
    expect(view.overlap.savedMinutes).toBeGreaterThan(15);
    expect(view.facts.some((f) => f.includes('Learning shared ideas once has saved you about'))).toBe(true);
    expect(view.facts.some((f) => f.includes('When you say you are sure, you are right'))).toBe(true);
    expect(view.growth[view.growth.length - 1]?.owned).toBeGreaterThan(0);
    expect(view.topics.length).toBeGreaterThan(0);
    // filtering by goal narrows the time
    expect(statsView(db, { goalId: econ.id, topicId: null, range: '30d' }, now).headline.minutes).toBe(60);
  });
});

describe('time stays where it was spent, and speed is one number', () => {
  /** Study logged the way the app logs it: the owners are asked for when the span opens. */
  function study(db: ReturnType<typeof setup>['db'], context: { goalId: string; nodeId?: string }, minutes: number, at: Date, surface: 'session' | 'practice' | 'cards' = 'session') {
    logTime(db, surface, context, minutes * 60, at, () => timeOwners(db, context));
  }
  /** A second goal over two ideas the game theory goal also holds. */
  function pricing(db: ReturnType<typeof setup>['db'], id: (k: string) => string) {
    const goal = createGoalFromForm(db, { text: 'Understand price competition', budget: { mode: 'total', hours: 4 }, materials: [] });
    addCapabilities(db, goal.id, [{ statement: 'Can find the equilibrium of a pricing game', targets: ['nash', 'bestResponse', 'dominant'].map((k) => ({ nodeId: id(k), depth: 3 as const })) }]);
    refreshGoalFields(db);
    return goal;
  }
  const t0 = new Date('2026-03-02T10:00:00Z');
  const spent = (db: ReturnType<typeof setup>['db'], goalId: string) => Math.round(spentByGoal(attributeTime(db)).get(goalId) ?? 0);

  it('a goal added later gets none of the time already spent, and the first goal keeps all of it', () => {
    const { db, id } = setup();
    const first = gameTheory(db, id, 20);
    study(db, { goalId: first.id, nodeId: id('nash') }, 60, t0);
    study(db, { goalId: first.id, nodeId: id('bestResponse') }, 60, new Date(t0.getTime() + DAY));
    expect(spent(db, first.id)).toBe(120);
    const second = pricing(db, id);
    expect(spent(db, first.id)).toBe(120);
    expect(spent(db, second.id)).toBe(0);
    expect(goalProgress(db, second.id)?.spentMinutes).toBe(0);
    // from now on, time on an idea both hold is shared
    study(db, { goalId: first.id, nodeId: id('nash') }, 30, new Date(t0.getTime() + 2 * DAY));
    expect(spent(db, first.id)).toBe(135);
    expect(spent(db, second.id)).toBe(15);
  });

  it('pausing, finishing or removing a goal moves no minutes and does not change the speed or the other plan', () => {
    const { db, id } = setup();
    const first = gameTheory(db, id, 20);
    const second = pricing(db, id);
    // both goals learned at about the model's pace: two shared ideas, an hour of sessions
    study(db, { goalId: first.id, nodeId: id('nash') }, 30, t0);
    study(db, { goalId: second.id, nodeId: id('bestResponse') }, 30, new Date(t0.getTime() + DAY));
    for (const k of ['nash', 'bestResponse']) recordEvidence(db, { nodeId: id(k), kind: 'derive', score: 0.9, reasoning: '', at: new Date(t0.getTime() + DAY).toISOString() });
    refreshGoalFields(db);
    const before = { speed: learnerSpeedNow(db), spentSecond: spent(db, second.id) };

    for (const status of ['paused', 'done'] as const) {
      setGoalStatus(db, first.id, status);
      expect(learnerSpeedNow(db), status).toBe(before.speed);
      expect(spent(db, second.id), status).toBe(before.spentSecond);
      setGoalStatus(db, first.id, 'active');
    }
    const total = statsView(db, { goalId: null, topicId: null, range: 'all' }, new Date(t0.getTime() + 3 * DAY)).headline.minutes;
    deleteGoal(db, first.id);
    expect(spent(db, second.id)).toBe(before.spentSecond);
    const after = statsView(db, { goalId: null, topicId: null, range: 'all' }, new Date(t0.getTime() + 3 * DAY));
    expect(after.headline.minutes).toBe(total); // the time was studied, whatever happened to the goal
    expect(after.weeks.some((w) => (w.minutes['removed'] ?? 0) > 0)).toBe(true);
  });

  it('what the probe shows the learner already knew is not counted as learning fast', async () => {
    const { db, id } = setup();
    const goal = gameTheory(db, id, 4);
    approveGoalPlan(db, goal.id);
    const provider = new FakeProvider({
      prober: (req: CompleteRequest<unknown>) => {
        const text = req.messages[0]?.content ?? '';
        const nodeIds = [...new Set([...text.matchAll(/(?:- \[|### )(node_[a-z0-9_]+)/g)].map((m) => m[1] as string))];
        if (text.startsWith('Judge')) return { assessments: nodeIds.map((nodeId) => ({ nodeId, score: 0.95, reasoning: 'Knew it.', misconception: null })), gaps: [] };
        return { questions: nodeIds.slice(0, 6).map((nodeId) => ({ nodeId, kind: 'derive', question: 'Why does this hold, in your own words?', answerKey: 'Because of its premises.', rubric: ['says why'] })) };
      },
    });
    const probe = await createProbe(db, provider, goal.id);
    logTime(db, 'probe', { goalId: goal.id }, 12 * 60, t0, () => [goal.id]);
    await submitProbe(db, provider, probe.id, probe.questions.map((q) => ({ problemId: q.problemId, answer: 'I know this.', confidence: 0.9 })));
    const known = listTargets(db, goal.id, { all: true }).filter((t) => (goalDetail(db, goal.id)?.goal.baseline[t.nodeId] ?? 0) > 0);
    expect(known.length).toBeGreaterThan(0); // the probe's findings joined the baseline
    // then an honest hour on one new idea, learned at about the model's pace
    study(db, { goalId: goal.id, nodeId: id('mixedIndifference') }, 60, new Date(t0.getTime() + DAY));
    expect(learnerSpeedNow(db)).toBe(1); // not 0.6, which would make every plan hold 1.7 times too much
  });

  it('time spent keeping what is known does not make the learner look slower', () => {
    const { db, id } = setup();
    const goal = gameTheory(db, id, 20);
    approveGoalPlan(db, goal.id);
    study(db, { goalId: goal.id, nodeId: id('nash') }, 60, t0);
    recordEvidence(db, { nodeId: id('nash'), kind: 'use', score: 0.9, reasoning: '', at: t0.toISOString() });
    refreshGoalFields(db);
    const speed = learnerSpeedNow(db);
    for (let week = 1; week <= 12; week += 1) {
      study(db, { goalId: goal.id }, 30, new Date(t0.getTime() + week * 7 * DAY), 'practice');
      study(db, { goalId: goal.id }, 10, new Date(t0.getTime() + week * 7 * DAY + 3_600_000), 'cards');
    }
    expect(learnerSpeedNow(db)).toBe(speed);
  });

  it('time logged before owners were stored gets them once and then stays put', () => {
    const { db, id } = setup();
    const first = gameTheory(db, id, 20);
    logTime(db, 'session', { goalId: first.id, nodeId: id('nash') }, 3600, t0); // as older versions logged it
    expect(freezeTimeOwners(db)).toBe(1);
    expect(freezeTimeOwners(db)).toBe(0);
    pricing(db, id);
    expect(spent(db, first.id)).toBe(60);
  });
});

describe('goal edge cases (R7 D14)', () => {
  const t0 = new Date('2026-03-02T10:00:00Z');

  it('a new time starts the rhythm again and drops the minutes that going deeper had added', () => {
    const { db, id } = setup();
    const goal = gameTheory(db, id, 40);
    approveGoalPlan(db, goal.id);
    // approved ten weeks ago, studied little
    db.prepare('UPDATE goals SET approved_at = ?, rhythm_at = ? WHERE id = ?').run(new Date(Date.now() - 70 * DAY).toISOString(), new Date(Date.now() - 70 * DAY).toISOString(), goal.id);
    addExtraMinutes(db, goal.id, 15);
    updateGoalFromForm(db, goal.id, { budget: { mode: 'rate', hours: 6, per: 'day', length: 2, lengthUnit: 'weeks' } });
    const progress = goalProgress(db, goal.id);
    expect(progress?.totalMinutes).toBe(6 * 60 * 14); // the new time, with nothing left over from the old one
    expect(progress?.pace.kind).not.toBe('behind_time'); // two weeks from today, not two months ago
    expect(new Date(`${progress?.endsOn}T12:00:00`).getTime()).toBeGreaterThan(Date.now());
    // and a goal taken up again after a rest is not behind for the weeks it rested
    db.prepare('UPDATE goals SET rhythm_at = ? WHERE id = ?').run(new Date(Date.now() - 70 * DAY).toISOString(), goal.id);
    setGoalStatus(db, goal.id, 'paused');
    setGoalStatus(db, goal.id, 'active');
    expect(goalProgress(db, goal.id)?.pace.kind).not.toBe('behind_time');
  });

  it('shows no weekly target once the date of the goal has passed', () => {
    const { db, id } = setup();
    const goal = gameTheory(db, id, 10);
    approveGoalPlan(db, goal.id);
    updateGoalFromForm(db, goal.id, { date: '2020-01-01' });
    expect(goalProgress(db, goal.id)?.weeklyTarget).toBeNull();
    updateGoalFromForm(db, goal.id, { date: new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10) });
    expect(goalProgress(db, goal.id)?.weeklyTarget).toBeLessThanOrEqual(600);
  });

  it('a premise outside the plan is charged once, however many ideas rest on it', () => {
    const { db, id } = setup();
    // three ideas that all rest on strategy and payoff, which no plan holds and the learner does not own
    const goal = createGoalFromForm(db, { text: 'Understand dominance', budget: { mode: 'total', hours: 4 }, materials: [] });
    addCapabilities(db, goal.id, [{ statement: 'Can use dominance', targets: ['bestResponse', 'dominant', 'dominated'].map((k) => ({ nodeId: id(k), depth: 2 as const })) }]);
    refreshGoalFields(db);
    const plan = goalProgress(db, goal.id)?.plan;
    // three terms at 12.5 minutes each, plus strategy and payoff once (50): 88, not 188 with the two charged three times
    expect(plan?.ideas.cut).toBe(0);
    expect(plan?.plannedMinutes).toBe(88);
  });

  it('previewing a new time keeps simplified ideas as they were learned, as saving does', () => {
    const { db, id } = setup();
    const goal = gameTheory(db, id, 20);
    approveGoalPlan(db, goal.id);
    capTargets(db, goal.id, id('nash'), 1, 'It was taking too long');
    refreshGoalFields(db);
    const preview = previewPlan(db, goal.id, { mode: 'total', hours: 30 });
    expect(preview?.ideas.find((i) => i.nodeId === id('nash'))?.plannedDepth).toBe(1);
    updateGoalFromForm(db, goal.id, { budget: { mode: 'total', hours: 30 } });
    expect(Math.max(...listTargets(db, goal.id).filter((t) => t.nodeId === id('nash')).map((t) => t.depth))).toBe(1);
  });

  it('a goal with only an exam or a syllabus as material is mapped from the goal itself', () => {
    const { db } = setup();
    const goal = createGoalFromForm(db, { text: 'Pass statistics', kind: 'course', assessment: 'written_exam', budget: { mode: 'total', hours: 20 }, materials: [] }, { draft: true });
    const exam = createSource(db, { kind: 'pdf', title: 'Past exam', path: null, hash: 'exam' }, [{ text: 'Question 1', locator: 'p1' }]);
    updateSourceStatus(db, exam.id, { status: 'done' });
    setMaterials(db, goal.id, [{ sourceId: exam.id, role: 'assessment' }]);
    db.prepare('UPDATE goals SET profile_sources = ? WHERE id = ?').run(JSON.stringify([exam.id]), goal.id); // the exam is already profiled
    expect(nextGoalStep(db, goal.id)).toBe('compile');
  });

  it('"Map more ideas" beside a run in flight does not compile twice', async () => {
    const { db } = setup();
    const goal = createGoalFromForm(db, { text: 'Learn it', budget: { mode: 'total', hours: 2 }, materials: [] }, { draft: true });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let compiles = 0;
    const provider = new FakeProvider({
      goalCompiler: async () => {
        compiles += 1;
        await held;
        return { title: 'It', level: 'working', scope: 'Learn it.', capabilities: [{ statement: 'Can do it', targets: [{ ref: 'n1', depth: 2, core: true }] }], newNodes: [{ tempId: 'n1', kind: 'claim', name: 'The idea', statement: 'It holds.' }] };
      },
    });
    const worker = new GoalWorker({ db: () => db, provider: () => provider, ingestion: () => { throw new Error('no reading in this test'); }, embedder: () => { throw new Error('no embedding in this test'); }, onChange: () => undefined });
    worker.refresh(goal.id);
    await Promise.resolve();
    await worker.compileNow(goal.id); // the learner presses the button while the first map is drawn
    expect(compiles).toBe(1);
    release();
    void t0;
  });

  it('offers time back when the learner turns out to know part of the approved plan', () => {
    const { db, id } = setup();
    const goal = gameTheory(db, id, 3);
    approveGoalPlan(db, goal.id);
    const before = goalProgress(db, goal.id);
    expect(before?.plan.ideas.cut).toBeGreaterThan(0); // three hours do not hold all twelve ideas
    expect(before?.room).toBeNull(); // and the plan uses its time

    // the probe (or anything else) shows that the planned ideas are already known
    const planned = listTargets(db, goal.id).map((t) => t.nodeId);
    for (const nodeId of new Set(planned)) recordEvidence(db, { nodeId, kind: 'use', score: 0.95, reasoning: 'knew it' });
    refreshGoalFields(db);
    const freed = goalProgress(db, goal.id);
    expect(freed?.plan.plannedMinutes).toBeLessThan(before?.plan.plannedMinutes ?? 0);
    expect(freed?.room?.more).toBeGreaterThan(0); // the approved plan cannot use the time: left-out ideas could come back
    expect(freed?.room?.minutes).toBeGreaterThanOrEqual(25);

    useFreedTime(db, goal.id);
    const after = goalProgress(db, goal.id);
    expect(after?.plan.ideas.cut).toBeLessThan(before?.plan.ideas.cut ?? 0);
    expect(after?.room).toBeNull(); // what the time holds is planned again
    expect(listActivity(db, { kinds: ['goal.extended'] })).toHaveLength(1);
  });
});

