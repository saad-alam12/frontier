import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { addCapabilities, getGoal, listCapabilities, listTargets, markCompiled } from '../store/goals';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { approveGoalPlan, createGoalFromForm } from './goals';
import { nextGoalStep } from './goalWorker';
import { refreshGoalFields } from './knowledge';
import { createProbe, submitProbe } from './probe';
import { approveRemap, dismissRemap, noteBackgroundGaps, proposeRemap, remapView, requestRemap } from './remap';

function setup(hours = 4) {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const id = (k: string) => ids.get(k) as string;
  const goal = createGoalFromForm(db, { text: 'Understand how strategic games are solved', budget: { mode: 'total', hours }, materials: [] }, { draft: true });
  addCapabilities(db, goal.id, [
    { statement: 'Can find Nash equilibria and prove they are stable', targets: ['nash', 'nashMutualBr', 'findPureNash'].map((k) => ({ nodeId: id(k), depth: 3 as const })) },
    { statement: 'Can solve a game by dominance', targets: ['dominant', 'iesds', 'dominantNash'].map((k) => ({ nodeId: id(k), depth: 3 as const })) },
  ]);
  markCompiled(db, goal.id, 'Strategic games', [], { level: 'rigorous', scope: 'Find and prove equilibria.' });
  approveGoalPlan(db, goal.id);
  return { db, id, goal };
}

/** A compiler that answers a re-map with a gentler map of two ideas and a separate goal for the background. */
function remapCompiler(id: (k: string) => string) {
  return (req: CompleteRequest<unknown>) => {
    const text = req.messages[0]?.content ?? '';
    expect(text).toContain('## Re-mapping');
    expect(text).toContain('Leave `extend` and `retire` empty');
    return {
      title: 'Strategic games, the big picture',
      level: 'intuition',
      scope: 'In the time left: what a stable choice is when others choose too, in plain words.',
      capabilities: [{ statement: 'Can explain what makes a pair of choices stable', targets: [{ ref: id('nash'), depth: 2, core: true }, { ref: 'm1', depth: 2, core: false }] }],
      newNodes: [{ tempId: 'm1', kind: 'claim', name: 'Nobody wants to switch alone', statement: 'At a stable pair of choices, no one gains by changing only their own choice.' }],
      backgroundGoal: { text: 'Learn what a best response is, with small examples', hours: 3 },
    };
  };
}

describe('re-map proposals', () => {
  it('turns what the probe showed is missing into a proposal, and changes nothing until it is approved', async () => {
    const { db, id, goal } = setup();
    const provider = new FakeProvider({
      prober: (req: CompleteRequest<unknown>) => {
        const text = req.messages[0]?.content ?? '';
        const nodeIds = [...text.matchAll(/(?:- \[|### )(node_[a-z0-9_]+)/g)].map((m) => m[1] as string);
        if (text.startsWith('Judge')) {
          return { assessments: [...new Set(nodeIds)].map((nodeId) => ({ nodeId, score: 0.1, reasoning: 'No idea what a best response is.', misconception: null })), gaps: [{ name: 'Best responses', hours: 3 }] };
        }
        return { questions: [{ nodeId: nodeIds[0], kind: 'check', question: 'What makes a pair of choices stable?', answerKey: 'Nobody gains alone.', rubric: ['unilateral'] }] };
      },
      goalCompiler: remapCompiler(id),
    });
    const probe = await createProbe(db, provider, goal.id);
    await submitProbe(db, provider, probe.id, probe.questions.map((q) => ({ problemId: q.problemId, answer: '', confidence: null })));
    expect(getGoal(db, goal.id)?.gaps.map((g) => [g.name, g.status])).toEqual([['Best responses', 'new']]);
    // three hours of background against four hours in all: too much to add, so a gentler map
    expect(nextGoalStep(db, goal.id)).toBe('remap');

    const before = { caps: listCapabilities(db, goal.id).map((c) => c.id), targets: listTargets(db, goal.id, { all: true }).length };
    await proposeRemap({ db, provider }, goal.id);
    expect(getGoal(db, goal.id)?.remap?.state).toBe('ready');
    expect(getGoal(db, goal.id)?.gaps[0]?.status).toBe('proposed');
    expect(nextGoalStep(db, goal.id)).toBeNull();
    expect(listCapabilities(db, goal.id).map((c) => c.id)).toEqual(before.caps);

    const view = remapView(db, goal.id);
    expect(view?.reason).toMatch(/missing Best responses \(about 3 hours\)/);
    expect(view?.level).toBe('intuition');
    expect(view?.backgroundGoal).toEqual({ text: 'Learn what a best response is, with small examples', hours: 3 });
    expect(view?.before?.ideas).toHaveLength(6);
    expect(view?.after?.ideas.map((i) => i.name).sort()).toEqual(['Nash equilibrium', 'Nobody wants to switch alone']);
    // the preview changed nothing
    expect(listCapabilities(db, goal.id).map((c) => c.id)).toEqual(before.caps);
    expect(listTargets(db, goal.id, { all: true })).toHaveLength(before.targets);

    approveRemap(db, goal.id);
    const after = getGoal(db, goal.id);
    expect(after?.remap).toBeNull();
    expect(after?.level).toBe('intuition');
    expect(after?.scope).toMatch(/plain words/);
    const targets = listTargets(db, goal.id, { all: true });
    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.approvedDepth === t.depth)).toBe(true);
  });

  it('keeps the map when the learner says no, and does not propose the same gaps again', async () => {
    const { db, id, goal } = setup();
    noteBackgroundGaps(db, goal.id, [{ name: 'Best responses', hours: 3 }], 'session');
    noteBackgroundGaps(db, goal.id, [{ name: 'best responses', hours: 2 }], 'session'); // the same gap, named again
    expect(getGoal(db, goal.id)?.gaps).toHaveLength(1);
    const provider = new FakeProvider({ goalCompiler: remapCompiler(id) });
    await proposeRemap({ db, provider }, goal.id);
    const caps = listCapabilities(db, goal.id).map((c) => c.id);
    dismissRemap(db, goal.id);
    expect(getGoal(db, goal.id)?.remap).toBeNull();
    expect(listCapabilities(db, goal.id).map((c) => c.id)).toEqual(caps);
    expect(nextGoalStep(db, goal.id)).toBeNull();
    // a small new gap is left to the tutor; asking for a new map still works
    noteBackgroundGaps(db, goal.id, [{ name: 'Payoff tables', hours: 0.5 }], 'session');
    expect(nextGoalStep(db, goal.id)).toBeNull();
    requestRemap(db, goal.id);
    expect(nextGoalStep(db, goal.id)).toBe('remap');
    refreshGoalFields(db);
  });
});
