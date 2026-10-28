import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../llm/FakeProvider';
import type { CompleteRequest } from '../llm/provider';
import { openDatabase } from '../store/db';
import { createGoal, listTargets, setMaterials } from '../store/goals';
import type { Database } from '../store/db';
import { listSources } from '../store/sources';
import { seedExampleGraph } from '../store/seed/exampleGraph';
import { getState, listEvidenceForNode } from '../store/evidence';
import { listBugsForNode } from '../store/bugs';
import { listNodes } from '../store/world';
import { compileGoal, goalDetail } from './goals';
import { recordEvidence } from './evidence';
import { loadKnowledge } from './knowledge';
import { createProbe, openProbe, probeDraftKey, submitProbe } from './probe';
import { getDrafts, setDraft } from '../store/drafts';
import { candidatesForGoal, planSession } from './planner';

function setup() {
  const db = openDatabase(':memory:');
  const ids = seedExampleGraph(db);
  const provider = new FakeProvider();
  return { db, ids, provider };
}

/** A goal whose teaching material is the seed graph's source. */
function seedGoal(db: Database, text: string, priority = 1) {
  const goal = createGoal(db, text, { priority });
  setMaterials(db, goal.id, [{ sourceId: listSources(db)[0]?.id as string, role: 'teaching' }]);
  return goal;
}

describe('goal compile', () => {
  it('stores capabilities and targets, creating unverified nodes for missing ideas', async () => {
    const { db, ids, provider } = setup();
    const goal = seedGoal(db, 'Pass the game theory exam with a 1.3', 2);
    provider.script('goalCompiler', (req: CompleteRequest<unknown>) => {
      expect(req.messages[0]?.content).toContain(`[${ids.get('nash')}] Nash equilibrium`);
      return {
        title: 'Game theory',
        coverage: 'complete',
        capabilities: [
          { statement: 'Can find all pure Nash equilibria of a small matrix game', targets: [{ ref: ids.get('nash'), depth: 4 }, { ref: ids.get('findPureNash'), depth: 4 }] },
          { statement: 'Can explain why dominated strategies are never played', targets: [{ ref: ids.get('dominatedNeverPlayed'), depth: 3 }, { ref: ids.get('nash'), depth: 2 }] },
          { statement: 'Can compute a mixed equilibrium of a 2x2 game', targets: [{ ref: 'm1', depth: 4 }, { ref: ids.get('mixedIndifference'), depth: 3 }] },
        ],
        newNodes: [{ tempId: 'm1', kind: 'procedure', name: 'Solve a 2x2 mixed equilibrium', statement: 'Set each player indifferent between their pure strategies and solve for the probabilities.' }],
      };
    });
    const detail = await compileGoal({ db, provider }, goal.id);
    expect(detail.capabilities).toHaveLength(3);
    expect(detail.goal.compiledAt).not.toBeNull();
    const created = listNodes(db).find((n) => n.name === 'Solve a 2x2 mixed equilibrium');
    expect(created?.status).toBe('unverified');
    const targets = listTargets(db, goal.id);
    expect(targets.filter((t) => t.nodeId === ids.get('nash')).map((t) => t.depth).sort()).toEqual([2, 4]);
    expect(getState(db, ids.get('nash') as string)?.targetDepth).toBe(4);
    expect(getState(db, ids.get('nash') as string)?.tier).toBe('internalize');
    expect(goalDetail(db, goal.id)?.capabilities[2]?.targets.some((t) => t.status === 'unverified')).toBe(true);
  });

  it('retries when the compiler references an unknown id', async () => {
    const { db, ids, provider } = setup();
    const goal = seedGoal(db, 'learn');
    const good = {
      title: 'Game theory',
      coverage: 'complete',
      capabilities: [
        { statement: 'Can explain Nash equilibrium', targets: [{ ref: ids.get('nash'), depth: 2 }] },
        { statement: 'Can explain best responses', targets: [{ ref: ids.get('bestResponse'), depth: 2 }] },
        { statement: 'Can explain dominance', targets: [{ ref: ids.get('dominant'), depth: 2 }] },
      ],
      newNodes: [],
    };
    provider.script('goalCompiler', { ...good, capabilities: [{ statement: 'Can explain Nash equilibrium', targets: [{ ref: 'node_ghost', depth: 2 }] }, ...good.capabilities] }, good);
    await compileGoal({ db, provider }, goal.id);
    expect(listTargets(db, goal.id)).toHaveLength(3);
  });
});

async function compiledGoal() {
  const { db, ids, provider } = setup();
  const goal = seedGoal(db, 'Pass the game theory exam', 2);
  provider.script('goalCompiler', {
    title: 'Game theory',
    coverage: 'complete',
    capabilities: [
      { statement: 'Can find pure Nash equilibria', targets: [{ ref: ids.get('nash'), depth: 4 }, { ref: ids.get('findPureNash'), depth: 4 }, { ref: ids.get('nashMutualBr'), depth: 3 }] },
      { statement: 'Can explain dominance results', targets: [{ ref: ids.get('dominantNash'), depth: 3 }, { ref: ids.get('dominant'), depth: 2 }] },
      { statement: 'Can explain SPE', targets: [{ ref: ids.get('spe'), depth: 2 }, { ref: ids.get('speIsNash'), depth: 2 }] },
    ],
    newNodes: [],
  });
  await compileGoal({ db, provider }, goal.id);
  return { db, ids, provider, goal };
}

describe('probe', () => {
  it('asks at most 8 high-information questions and writes evidence with implied premises', async () => {
    const { db, ids, provider, goal } = await compiledGoal();
    provider.script('prober', (req: CompleteRequest<unknown>) => {
      const text = req.messages[0]?.content ?? '';
      if (text.startsWith('Judge')) {
        return {
          assessments: [
            { nodeId: ids.get('nashMutualBr'), score: 0.9, reasoning: 'Derived it cleanly from best responses.', misconception: null },
            { nodeId: ids.get('nash'), score: 0.2, reasoning: 'Thinks Nash means the best outcome for everyone.', misconception: 'Believes a Nash equilibrium maximizes total payoff.' },
          ],
        };
      }
      // the first candidate listed is the highest-information one
      const first = /- \[(node_[a-z0-9_]+)\]/.exec(text)?.[1];
      expect(first).toBe(ids.get('nash'));
      return {
        questions: [
          { nodeId: ids.get('nashMutualBr'), kind: 'derive', question: 'Why is a profile where everyone best-responds stable, and conversely?', answerKey: 'Both directions of the characterization.', rubric: ['states iff', 'uses best response definition'] },
          { nodeId: ids.get('nash'), kind: 'check', question: 'What makes a profile an equilibrium?', answerKey: 'No profitable unilateral deviation.', rubric: ['unilateral', 'no gain'] },
        ],
      };
    });
    const probe = await createProbe(db, provider, goal.id);
    expect(probe.questions.length).toBeLessThanOrEqual(8);
    expect(probe.questions.map((q) => q.nodeId)).toEqual([ids.get('nashMutualBr'), ids.get('nash')]);
    expect(JSON.stringify(probe)).not.toContain('answerKey');

    // the open probe and its drafts survive leaving the screen (a fresh read from the database)
    const firstKey = probeDraftKey(probe.questions[0]?.problemId as string);
    setDraft(db, firstKey, JSON.stringify({ answer: 'half typed' }));
    expect(openProbe(db, goal.id)).toEqual(probe);
    expect(getDrafts(db, [firstKey])[firstKey]).toContain('half typed');

    const outcomes = await submitProbe(
      db,
      provider,
      probe.id,
      probe.questions.map((q) => ({ problemId: q.problemId, answer: 'an answer', confidence: 0.66 })),
    );
    expect(outcomes).toHaveLength(2);
    expect(openProbe(db, goal.id)).toBeNull();
    expect(getDrafts(db, [firstKey])).toEqual({});
    const derived = outcomes.find((o) => o.nodeId === ids.get('nashMutualBr'));
    expect(derived?.impliedPremises.map((p) => p.nodeId).sort()).toEqual([ids.get('bestResponse'), ids.get('nash')].sort());
    expect(getState(db, ids.get('nashMutualBr') as string)?.depth).toBe(3);
    expect(getState(db, ids.get('bestResponse') as string)?.depth).toBe(2);
    expect(listEvidenceForNode(db, ids.get('nash') as string)).toHaveLength(2); // the failed check and the implied premise credit
    expect(listBugsForNode(db, ids.get('nash') as string)).toHaveLength(1);
  });
});

describe('planner', () => {
  it('only plans nodes reachable from the fringe, in dependency order', async () => {
    const { db, ids, provider, goal } = await compiledGoal();
    const own = (key: string) => recordEvidence(db, { nodeId: ids.get(key) as string, kind: 'explain', score: 0.95, reasoning: 't' });
    for (const key of ['strategy', 'payoff', 'extensive']) own(key);
    const { candidates, unreachable } = candidatesForGoal(db, goal.id);
    const candidateIds = new Set(candidates.map((c) => c.nodeId));
    expect(candidateIds.has(ids.get('bestResponse') as string)).toBe(true);
    expect(candidateIds.has(ids.get('nash') as string)).toBe(true);
    expect(candidateIds.has(ids.get('findPureNash') as string)).toBe(true);
    expect(unreachable).toEqual([]);
    const view = loadKnowledge(db);
    for (const c of candidates) expect(view.owned.has(c.nodeId)).toBe(false);

    provider.script(
      'planner',
      // first attempt picks an owned node that is not a candidate: rejected, retried
      { title: 'Equilibrium', orientation: 'Today builds Nash equilibrium from best responses.', steps: [{ nodeId: ids.get('strategy'), why: 'basics' }] },
      {
        title: 'Equilibrium',
        orientation: 'Today builds Nash equilibrium from best responses.',
        steps: [
          { nodeId: ids.get('nash'), why: 'the central concept of the exam' },
          { nodeId: ids.get('bestResponse'), why: 'Nash is defined through it' },
          { nodeId: ids.get('profile'), why: 'needed to state Nash' },
        ],
      },
    );
    const plan = await planSession(db, provider, goal.id);
    expect(plan.steps.map((s) => s.nodeId).slice(0, 2).sort()).toEqual([ids.get('bestResponse'), ids.get('profile')].sort());
    expect(plan.steps[2]?.nodeId).toBe(ids.get('nash'));
    expect(plan.steps[2]?.mode).toBe('derive');
    expect(plan.steps[2]?.dependsOn.sort()).toEqual([ids.get('bestResponse'), ids.get('profile')].sort());
    expect(plan.candidateCount).toBeGreaterThan(3);
  });

  it('reports targets that cannot be reached from the fringe', async () => {
    const { db, ids, provider } = setup();
    const goal = seedGoal(db, 'exam');
    provider.script('goalCompiler', {
      title: 'Exam',
      coverage: 'complete',
      capabilities: [
        { statement: 'Can explain a ghost idea', targets: [{ ref: 'm1', depth: 2 }] },
        { statement: 'Can explain Nash', targets: [{ ref: ids.get('nash'), depth: 2 }] },
        { statement: 'Can explain strategies', targets: [{ ref: ids.get('strategy'), depth: 1 }] },
      ],
      newNodes: [{ tempId: 'm1', kind: 'claim', name: 'Ghost theorem', statement: 'A claim the sources do not cover yet.' }],
    });
    await compileGoal({ db, provider }, goal.id);
    const { candidates, unreachable } = candidatesForGoal(db, goal.id);
    expect(unreachable.map((u) => u.name)).toEqual(['Ghost theorem']);
    // nothing owned: the root terms the targets are built on are the fringe, and Nash is reachable through them
    expect(candidates.filter((c) => c.onFringe).map((c) => c.nodeId).sort()).toEqual([ids.get('payoff'), ids.get('strategy')].sort());
    expect(candidates.map((c) => c.nodeId)).toContain(ids.get('nash'));
  });
});
